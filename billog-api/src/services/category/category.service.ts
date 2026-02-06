import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(private prisma: PrismaService) {}

  async getAllCategories() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      include: {
        children: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getCategoryById(id: string) {
    return this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        parent: true,
      },
    });
  }

  async findCategoryByName(name: string) {
    return this.prisma.category.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          { nameLocalized: { equals: name, mode: 'insensitive' } },
        ],
      },
    });
  }

  async createCategory(params: {
    name: string;
    nameLocalized?: string;
    icon?: string;
    color?: string;
    parentId?: string;
  }) {
    return this.prisma.category.create({
      data: params,
    });
  }
}
