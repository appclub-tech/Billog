import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CategoryService } from '../../services/category/category.service.js';
import { AuthGuard } from '../guards/auth.guard.js';

@Controller('categories')
export class CategoryController {
  constructor(private categoryService: CategoryService) {}

  @Get()
  @UseGuards(AuthGuard)
  async getAllCategories() {
    const categories = await this.categoryService.getAllCategories();
    return { categories };
  }

  @Get('by-name/:name')
  @UseGuards(AuthGuard)
  async getCategoryByName(@Param('name') name: string) {
    const category = await this.categoryService.findCategoryByName(name);
    return { category };
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getCategoryById(@Param('id') id: string) {
    const category = await this.categoryService.getCategoryById(id);
    if (!category) {
      return { error: 'Category not found' };
    }
    return { category };
  }
}
