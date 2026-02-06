import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentMethodType } from '@prisma/client';

export interface PaymentInfo {
  method?: string; // 'credit_card', 'debit_card', 'cash', etc.
  cardType?: string; // 'VISA', 'MASTERCARD', etc.
  cardLast4?: string; // '7016'
  bankName?: string; // 'SCB', 'KBANK', etc.
  approvalCode?: string;
}

@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Find or create a payment method from receipt payment info
   * Returns the payment method ID to link with expense
   */
  async findOrCreateFromPaymentInfo(
    userId: string,
    paymentInfo: PaymentInfo,
  ): Promise<string | null> {
    if (!paymentInfo || !paymentInfo.method) {
      return null;
    }

    // Map payment method string to enum
    const type = this.mapPaymentType(paymentInfo.method, paymentInfo.cardType);
    if (!type) {
      this.logger.warn(`Unknown payment method: ${paymentInfo.method}`);
      return null;
    }

    // For cards, try to find existing by last4 + type + bank
    if (paymentInfo.cardLast4 && (type === 'CREDIT_CARD' || type === 'DEBIT_CARD')) {
      const existing = await this.prisma.paymentMethod.findFirst({
        where: {
          userId,
          type,
          last4: paymentInfo.cardLast4,
          bankName: paymentInfo.bankName || null,
          isActive: true,
        },
      });

      if (existing) {
        this.logger.log(`Found existing card: ${existing.name} (${existing.id})`);
        return existing.id;
      }

      // Create new card
      const cardName = this.generateCardName(paymentInfo);
      const newCard = await this.prisma.paymentMethod.create({
        data: {
          userId,
          name: cardName,
          type,
          last4: paymentInfo.cardLast4,
          bankName: paymentInfo.bankName,
          metadata: {
            cardType: paymentInfo.cardType,
            autoCreated: true,
            createdFrom: 'receipt',
          },
        },
      });

      this.logger.log(`Created new card: ${newCard.name} (${newCard.id})`);
      return newCard.id;
    }

    // For non-card methods (cash, bank transfer, etc.), find or use default
    const existing = await this.prisma.paymentMethod.findFirst({
      where: {
        userId,
        type,
        isActive: true,
      },
    });

    if (existing) {
      return existing.id;
    }

    // Create new payment method
    const newMethod = await this.prisma.paymentMethod.create({
      data: {
        userId,
        name: this.getDefaultName(type),
        type,
        metadata: {
          autoCreated: true,
          createdFrom: 'receipt',
        },
      },
    });

    this.logger.log(`Created new payment method: ${newMethod.name} (${newMethod.id})`);
    return newMethod.id;
  }

  /**
   * Link a payment method to an expense
   */
  async linkToExpense(
    expenseId: string,
    paymentMethodId: string,
    amount: number,
  ): Promise<void> {
    await this.prisma.expensePaymentMethod.upsert({
      where: {
        expenseId_paymentMethodId: {
          expenseId,
          paymentMethodId,
        },
      },
      create: {
        expenseId,
        paymentMethodId,
        amount,
      },
      update: {
        amount,
      },
    });
  }

  /**
   * Map payment method string to PaymentMethodType enum
   */
  private mapPaymentType(method: string, cardType?: string): PaymentMethodType | null {
    const normalized = method.toLowerCase().replace(/[^a-z]/g, '');

    // Credit card variants
    if (normalized.includes('credit') || normalized === 'creditcard') {
      return 'CREDIT_CARD';
    }

    // Debit card variants
    if (normalized.includes('debit') || normalized === 'debitcard') {
      return 'DEBIT_CARD';
    }

    // Generic "card" - check cardType
    if (normalized === 'card' || normalized.includes('card')) {
      if (cardType?.toLowerCase().includes('debit')) {
        return 'DEBIT_CARD';
      }
      return 'CREDIT_CARD'; // Default to credit
    }

    // Cash
    if (normalized === 'cash' || normalized.includes('cash')) {
      return 'CASH';
    }

    // Bank transfer
    if (normalized.includes('transfer') || normalized.includes('bank')) {
      return 'BANK_TRANSFER';
    }

    // PromptPay / QR
    if (normalized.includes('promptpay') || normalized.includes('qr')) {
      return 'PROMPTPAY';
    }

    // E-wallet
    if (normalized.includes('wallet') || normalized.includes('truemoney') || normalized.includes('rabbit')) {
      return 'EWALLET';
    }

    return null;
  }

  /**
   * Generate a friendly card name
   */
  private generateCardName(info: PaymentInfo): string {
    const parts: string[] = [];

    if (info.bankName) {
      parts.push(info.bankName);
    }

    if (info.cardType) {
      parts.push(info.cardType);
    }

    if (info.cardLast4) {
      parts.push(`**${info.cardLast4}`);
    }

    return parts.length > 0 ? parts.join(' ') : 'Card';
  }

  /**
   * Get default name for payment type
   */
  private getDefaultName(type: PaymentMethodType): string {
    switch (type) {
      case 'CASH':
        return 'Cash';
      case 'CREDIT_CARD':
        return 'Credit Card';
      case 'DEBIT_CARD':
        return 'Debit Card';
      case 'BANK_TRANSFER':
        return 'Bank Transfer';
      case 'PROMPTPAY':
        return 'PromptPay';
      case 'EWALLET':
        return 'E-Wallet';
      default:
        return 'Other';
    }
  }

  /**
   * Get user's payment methods
   */
  async getUserPaymentMethods(userId: string) {
    return this.prisma.paymentMethod.findMany({
      where: { userId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }
}
