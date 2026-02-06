import { Module } from '@nestjs/common';
import { UserService } from './user.service.js';
import { IdentityService } from './identity.service.js';
import { PaymentMethodService } from './payment-method.service.js';

@Module({
  providers: [UserService, IdentityService, PaymentMethodService],
  exports: [UserService, IdentityService, PaymentMethodService],
})
export class UserModule {}
