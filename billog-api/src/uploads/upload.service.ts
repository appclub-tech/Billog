import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadDir: string;

  constructor(private configService: ConfigService) {
    this.uploadDir = path.resolve(process.cwd(), 'data', 'uploads');
  }

  async saveFile(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const ext = this.getExtension(mimeType);
    const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
    const timestamp = Date.now();
    const safeName = `${timestamp}-${hash}${ext}`;

    const filePath = path.join(this.uploadDir, safeName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);

    this.logger.log(`Saved file: ${safeName}`);
    return `/static/uploads/${safeName}`;
  }

  private getExtension(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/heic': '.heic',
    };
    return mimeToExt[mimeType] || '.bin';
  }
}
