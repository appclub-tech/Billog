import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Logger,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SourceService } from '../../services/source/source.service.js';
import { AuthGuard, GetUser, JwtPayload } from '../guards/auth.guard.js';
import { CreateReceiptDto } from '../dto/create-receipt.dto.js';

@Controller('receipts')
export class ReceiptController {
  private readonly logger = new Logger(ReceiptController.name);

  constructor(
    private prisma: PrismaService,
    private sourceService: SourceService,
  ) {}

  private getReqId(req: Request): string {
    return (req as any).requestId || 'no-req';
  }

  /**
   * Create receipt record (requires expenseId - receipts are created AFTER expenses)
   *
   * Note: The primary flow is through POST /expenses with receiptData.
   * This endpoint is for manual receipt creation or linking.
   */
  @Post()
  @UseGuards(AuthGuard)
  async createReceipt(
    @Body() dto: CreateReceiptDto,
    @GetUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const reqId = this.getReqId(req);

    this.logger.log(`[${reqId}] createReceipt | store=${dto.storeName || 'unknown'}`);

    // expenseId is REQUIRED - receipts must be linked to an expense
    if (!dto.expenseId) {
      this.logger.warn(`[${reqId}] ❌ Missing expenseId - receipts require an expense`);
      return { error: 'expenseId is required. Create expense first, then create receipt.' };
    }

    // Verify expense exists
    const expense = await this.prisma.expense.findUnique({
      where: { id: dto.expenseId },
      select: { id: true, sourceId: true },
    });

    if (!expense) {
      return { error: `Expense ${dto.expenseId} not found` };
    }

    // Parse receipt date
    const receiptDate = dto.receiptDate ? new Date(dto.receiptDate) : new Date();

    // Create receipt record linked to expense
    const receipt = await this.prisma.receipt.create({
      data: {
        expenseId: dto.expenseId,
        sourceId: expense.sourceId,
        imageUrl: dto.imageUrl,
        storeName: dto.storeName,
        storeAddress: dto.storeAddress,
        receiptDate,
        subtotal: dto.subtotal,
        tax: dto.tax,
        total: dto.total,
        currency: dto.currency || 'THB',
        rawOcrData: dto.rawOcrData as Prisma.InputJsonValue,
        confidence: dto.confidence,
      },
    });

    this.logger.log(`[${reqId}] Receipt created | id=${receipt.id} expenseId=${dto.expenseId}`);

    return {
      receipt: {
        id: receipt.id,
        expenseId: receipt.expenseId,
        storeName: receipt.storeName,
        total: receipt.total?.toNumber(),
        currency: receipt.currency,
      },
    };
  }

  /**
   * Get receipt by ID
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async getReceiptById(@Param('id') id: string, @Req() req: Request) {
    const reqId = this.getReqId(req);
    this.logger.log(`[${reqId}] getReceiptById | id=${id}`);

    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        expense: {
          select: { id: true, description: true, amount: true },
        },
      },
    });

    if (!receipt) {
      return { error: 'Receipt not found' };
    }

    return {
      receipt: {
        id: receipt.id,
        expenseId: receipt.expenseId,
        storeName: receipt.storeName,
        storeAddress: receipt.storeAddress,
        receiptDate: receipt.receiptDate?.toISOString(),
        subtotal: receipt.subtotal?.toNumber(),
        tax: receipt.tax?.toNumber(),
        total: receipt.total?.toNumber(),
        currency: receipt.currency,
        expense: receipt.expense,
      },
    };
  }
}
