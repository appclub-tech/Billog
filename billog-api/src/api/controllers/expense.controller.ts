import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { ExpenseService } from '../../services/expense/expense.service.js';
import { ReconciliationService } from '../../services/expense/reconciliation.service.js';
import { SourceService } from '../../services/source/source.service.js';
import { MemberService } from '../../services/source/member.service.js';
import { IdentityService } from '../../services/user/identity.service.js';
import { PaymentMethodService, PaymentInfo } from '../../services/user/payment-method.service.js';
import { SplitService, SplitType, ItemSplit } from '../../services/ledger/split.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthGuard, GetUser, JwtPayload } from '../guards/auth.guard.js';
import { CreateExpenseDto } from '../dto/create-expense.dto.js';
import { ReconcileExpenseDto } from '../dto/reconcile-expense.dto.js';

@Controller('expenses')
export class ExpenseController {
  private readonly logger = new Logger(ExpenseController.name);

  constructor(
    private expenseService: ExpenseService,
    private reconciliationService: ReconciliationService,
    private sourceService: SourceService,
    private memberService: MemberService,
    private identityService: IdentityService,
    private paymentMethodService: PaymentMethodService,
    private splitService: SplitService,
    private prisma: PrismaService,
  ) {}

  private getReqId(req: Request): string {
    return (req as any).requestId || 'no-req';
  }

  private log(reqId: string, step: number, message: string, data?: any) {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    this.logger.log(`[${reqId}] Step ${step}: ${message}${dataStr}`);
  }

  /**
   * Create expense with splits (called by OpenClaw skill)
   */
  @Post()
  @UseGuards(AuthGuard)
  async createExpense(
    @Body() dto: CreateExpenseDto,
    @GetUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const reqId = this.getReqId(req);
    let step = 0;

    this.log(reqId, ++step, 'START createExpense', {
      description: dto.description,
      amount: dto.amount,
      currency: dto.currency || 'THB',
      splitType: dto.splitType,
      itemCount: dto.items?.length || 0,
    });

    // Use context from JWT if not provided in body
    const channel = dto.channel || user.channel;
    const senderChannelId = dto.senderChannelId || user.senderChannelId;
    const sourceChannelId = dto.sourceChannelId || user.sourceChannelId;
    const sourceType = dto.sourceType || user.sourceType || 'GROUP';

    this.log(reqId, ++step, 'Resolved context', {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType,
    });

    if (!channel || !senderChannelId || !sourceChannelId) {
      this.logger.warn(`[${reqId}] ❌ Missing required fields`);
      return { error: 'channel, senderChannelId, and sourceChannelId are required' };
    }

    // 1. Get or create source
    this.log(reqId, ++step, 'Getting/creating source...');
    const source = await this.sourceService.getOrCreateSource(
      channel,
      sourceChannelId,
      sourceType,
    );
    this.log(reqId, step, 'Source resolved', { sourceId: source.id, sourceName: source.name });

    // 2. Resolve sender identity
    this.log(reqId, ++step, 'Resolving sender identity...');
    const { user: payer, isNew: isNewUser } = await this.identityService.resolveIdentity(
      channel,
      senderChannelId,
    );
    this.log(reqId, step, 'Payer resolved', {
      userId: payer.id,
      userName: payer.name,
      isNewUser,
    });

    // 3. Add sender as member if not already
    this.log(reqId, ++step, 'Adding sender as member...');
    const memberResult = await this.memberService.addMember(source.id, channel, senderChannelId);
    this.log(reqId, step, 'Membership ensured', {
      memberId: memberResult.member.id,
      isActive: memberResult.member.isActive,
    });

    // 4. Sync group members if provided (WhatsApp)
    if (dto.groupMembers && dto.groupMembers.length > 0) {
      this.log(reqId, ++step, 'Syncing group members...', { count: dto.groupMembers.length });
      const syncResult = await this.memberService.syncMembers(source.id, channel, dto.groupMembers);
      this.log(reqId, step, 'Members synced', {
        added: syncResult.added,
        updated: syncResult.updated,
        deactivated: syncResult.deactivated,
      });
    }

    // 5. Resolve category (use provided ID or default to "Other")
    let categoryId = dto.categoryId;
    if (!categoryId) {
      const otherCategory = await this.prisma.category.findUnique({
        select: { id: true },
        where: { name: 'Other' },
      });
      categoryId = otherCategory?.id;
    }
    this.log(reqId, step, 'Category resolved', { categoryId });

    // 6. Create expense (with items if provided)
    // Parse date from receipt if provided, otherwise use current date
    const expenseDate = dto.date ? new Date(dto.date) : new Date();
    this.log(reqId, ++step, 'Creating expense record...', { date: expenseDate.toISOString() });

    const expense = dto.items && dto.items.length > 0
      ? await this.expenseService.createExpenseWithItems(
          {
            sourceId: source.id,
            paidById: payer.id,
            description: dto.description,
            amount: dto.amount,
            currency: dto.currency || 'THB',
            categoryId,
            date: expenseDate,
            notes: dto.notes,
            metadata: dto.metadata as Prisma.InputJsonValue, // Payment info, receipt metadata
          },
          dto.items.map((item) => ({
            name: item.name,
            nameLocalized: item.nameLocalized,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            ingredientType: item.ingredientType,
            assignedTo: item.assignedTo,
          })),
        )
      : await this.expenseService.createExpense({
          sourceId: source.id,
          paidById: payer.id,
          description: dto.description,
          amount: dto.amount,
          currency: dto.currency || 'THB',
          categoryId,
          date: expenseDate,
          notes: dto.notes,
          metadata: dto.metadata as Prisma.InputJsonValue, // Payment info, receipt metadata
        });

    this.log(reqId, step, 'Expense created', {
      expenseId: expense.id,
      amount: expense.amount.toNumber(),
      itemCount: (expense as any).items?.length || 0,
    });

    // 6a. Create Receipt record if receiptData provided (from OCR extraction)
    let createdReceiptId: string | null = null;
    if (dto.receiptData) {
      this.log(reqId, ++step, 'Creating Receipt record...', {
        storeName: dto.receiptData.storeName,
        total: dto.receiptData.total,
      });

      const receipt = await this.prisma.receipt.create({
        data: {
          expenseId: expense.id,
          sourceId: source.id,
          imageUrl: dto.receiptData.imageUrl,
          storeName: dto.receiptData.storeName,
          storeAddress: dto.receiptData.storeAddress,
          receiptDate: expenseDate,
          subtotal: dto.receiptData.subtotal,
          tax: dto.receiptData.tax,
          total: dto.receiptData.total,
          currency: dto.currency || 'THB',
          rawOcrData: dto.receiptData.rawOcrData as Prisma.InputJsonValue,
          confidence: dto.receiptData.confidence,
        },
      });

      createdReceiptId = receipt.id;
      this.log(reqId, step, 'Receipt created', { receiptId: receipt.id });
    }

    // 6b. Auto-link payment method if payment info is in metadata
    let linkedPaymentMethod: string | null = null;
    this.log(reqId, ++step, 'Checking for payment info...', {
      hasMetadata: !!dto.metadata,
      metadataKeys: dto.metadata ? Object.keys(dto.metadata) : [],
    });

    if (dto.metadata && typeof dto.metadata === 'object') {
      const metadata = dto.metadata as Record<string, unknown>;
      const paymentInfo = metadata.payment as PaymentInfo | undefined;

      this.log(reqId, step, 'Payment info extracted', {
        hasPaymentInfo: !!paymentInfo,
        paymentInfo: paymentInfo || 'null',
      });

      if (paymentInfo && paymentInfo.method) {
        this.log(reqId, step, 'Processing payment method...', {
          method: paymentInfo.method,
          cardType: paymentInfo.cardType,
          last4: paymentInfo.cardLast4,
        });

        const paymentMethodId = await this.paymentMethodService.findOrCreateFromPaymentInfo(
          payer.id,
          paymentInfo,
        );

        if (paymentMethodId) {
          await this.paymentMethodService.linkToExpense(
            expense.id,
            paymentMethodId,
            dto.amount,
          );
          linkedPaymentMethod = paymentMethodId;
          this.log(reqId, step, 'Payment method linked', { paymentMethodId });
        } else {
          this.log(reqId, step, 'Payment method not created (unknown type)', { method: paymentInfo.method });
        }
      }
    }

    // 7. Calculate and create splits
    let splitResult = null;
    if (dto.splitType || dto.splits) {
      const splitType: SplitType = dto.splitType || 'equal';

      this.log(reqId, ++step, 'Calculating splits...', { splitType });

      // Convert items to ItemSplit format if needed
      const itemSplits: ItemSplit[] | undefined = dto.items?.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice,
        assignedTo: item.assignedTo,
        ingredientType: item.ingredientType,
      }));

      const calculatedSplits = await this.splitService.calculateSplits(
        source.id,
        channel,
        dto.amount,
        splitType,
        payer.id,
        dto.splits,
        itemSplits,
      );

      this.log(reqId, step, 'Splits calculated', {
        participantCount: calculatedSplits.size,
        splits: Array.from(calculatedSplits.entries()).map(([userId, amount]) => ({
          userId,
          amount: amount.toNumber(),
        })),
      });

      if (calculatedSplits.size > 0) {
        this.log(reqId, ++step, 'Creating ledger transfers...');
        splitResult = await this.splitService.createExpenseSplitTransfers(
          expense.id,
          source.id,
          payer.id,
          calculatedSplits,
          dto.currency || 'THB',
        );
        this.log(reqId, step, 'Ledger transfers created', {
          transferCount: splitResult.transfers.length,
        });
      }
    }

    // 7. Get user names for splits
    const splitUsers: { userId: string; name: string | null; amount: number }[] = [];
    if (splitResult) {
      this.log(reqId, ++step, 'Enriching split data with user names...');
      const userIds = splitResult.splits.map((s) => s.userId);
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.name]));

      for (const split of splitResult.splits) {
        splitUsers.push({
          userId: split.userId,
          name: userMap.get(split.userId) || null,
          amount: split.amount.toNumber(),
        });
      }
      this.log(reqId, step, 'Split data enriched', { splitCount: splitUsers.length });
    }

    this.logger.log(`[${reqId}] ✅ COMPLETE createExpense | expenseId=${expense.id}`);

    return {
      expense: {
        id: expense.id,
        description: expense.description,
        amount: expense.amount.toNumber(),
        currency: expense.currency,
        paidBy: (expense as any).paidBy || { id: payer.id, name: payer.name },
        category: (expense as any).category || null,
      },
      splits: splitUsers,
    };
  }

  /**
   * Get expenses (with optional filtering)
   */
  @Get()
  @UseGuards(AuthGuard)
  async getExpenses(
    @Query('sourceChannelId') sourceChannelId: string,
    @Query('channel') channel: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoryId') categoryId?: string,
    @Req() req?: Request,
  ) {
    const reqId = req ? this.getReqId(req) : 'no-req';

    this.logger.log(`[${reqId}] getExpenses | channel=${channel} sourceChannelId=${sourceChannelId}`);

    if (!sourceChannelId || !channel) {
      return { error: 'sourceChannelId and channel are required' };
    }

    const source = await this.sourceService.findByChannel(
      channel as any,
      sourceChannelId,
    );

    if (!source) {
      this.logger.log(`[${reqId}] Source not found, returning empty`);
      return { expenses: [], total: 0 };
    }

    const where: any = { sourceId: source.id };
    if (categoryId) where.categoryId = categoryId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      include: {
        paidBy: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, nameLocalized: true, icon: true } },
      },
      orderBy: { date: 'desc' },
      take: parseInt(limit || '20', 10),
    });

    this.logger.log(`[${reqId}] ✅ Found ${expenses.length} expenses`);

    return {
      expenses: expenses.map((e) => ({
        id: e.id,
        description: e.description,
        amount: e.amount.toNumber(),
        currency: e.currency,
        date: e.date.toISOString(),
        paidBy: e.paidBy,
        category: e.category,
      })),
      total: expenses.length,
    };
  }

  /**
   * Get expense by ID
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async getExpenseById(@Param('id') id: string, @Req() req?: Request) {
    const reqId = req ? this.getReqId(req) : 'no-req';
    this.logger.log(`[${reqId}] getExpenseById | id=${id}`);

    const expense = await this.expenseService.getExpenseById(id);

    if (!expense) {
      this.logger.warn(`[${reqId}] Expense not found: ${id}`);
      return { error: 'Expense not found' };
    }

    this.logger.log(`[${reqId}] ✅ Found expense: ${expense.description}`);

    return {
      expense: {
        id: expense.id,
        description: expense.description,
        amount: expense.amount.toNumber(),
        currency: expense.currency,
        date: expense.date.toISOString(),
        paidBy: expense.paidBy,
        category: expense.category,
        items: expense.items?.map((i) => ({
          name: i.name,
          quantity: i.quantity.toNumber(),
          unitPrice: i.unitPrice.toNumber(),
          totalPrice: i.totalPrice.toNumber(),
          ingredientType: i.ingredientType,
          assignedTo: i.assignedTo,
        })),
      },
    };
  }

  /**
   * Reconcile/adjust an existing expense
   * Modifies items and recalculates splits with adjustment transfers
   */
  @Post(':id/reconcile')
  @UseGuards(AuthGuard)
  async reconcileExpense(
    @Param('id') id: string,
    @Body() dto: ReconcileExpenseDto,
    @GetUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const reqId = this.getReqId(req);
    let step = 0;

    this.log(reqId, ++step, 'START reconcileExpense', {
      expenseId: id,
      adjustmentCount: dto.adjustments.length,
      reason: dto.reason,
    });

    const channel = dto.channel || user.channel;
    const sourceChannelId = dto.sourceChannelId || user.sourceChannelId;

    if (!channel || !sourceChannelId) {
      this.logger.warn(`[${reqId}] ❌ Missing required fields`);
      return { error: 'channel and sourceChannelId are required' };
    }

    try {
      this.log(reqId, ++step, 'Applying adjustments...');
      const result = await this.reconciliationService.reconcileExpense({
        expenseId: id,
        channel,
        sourceChannelId,
        adjustments: dto.adjustments,
        reason: dto.reason,
      });

      this.logger.log(`[${reqId}] ✅ COMPLETE reconcileExpense | adjustments=${result.adjustments.length}`);

      return {
        expense: {
          id: result.expense?.id,
          description: result.expense?.description,
          amount: result.expense?.amount.toNumber(),
          currency: result.expense?.currency,
          paidBy: result.expense?.paidBy,
          category: result.expense?.category,
          items: result.expense?.items?.map((i) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity.toNumber(),
            unitPrice: i.unitPrice.toNumber(),
            totalPrice: i.totalPrice.toNumber(),
            assignedTo: i.assignedTo,
          })),
        },
        adjustments: result.adjustments,
        transfers: result.transfers,
      };
    } catch (error) {
      this.logger.error(`[${reqId}] ❌ Reconciliation failed: ${error}`);
      return { error: error instanceof Error ? error.message : 'Reconciliation failed' };
    }
  }

  /**
   * Delete expense
   */
  @Delete(':id')
  @UseGuards(AuthGuard)
  async deleteExpense(@Param('id') id: string, @Req() req?: Request) {
    const reqId = req ? this.getReqId(req) : 'no-req';
    this.logger.log(`[${reqId}] deleteExpense | id=${id}`);

    await this.expenseService.deleteExpense(id);

    this.logger.log(`[${reqId}] ✅ Expense deleted: ${id}`);
    return { success: true };
  }
}
