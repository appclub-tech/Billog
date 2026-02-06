import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed categories (name in English, nameLocalized for Thai users)
  const categories = [
    { name: 'Food', nameLocalized: 'อาหาร', icon: '🍔', color: '#FF6B6B', sortOrder: 1 },
    { name: 'Transport', nameLocalized: 'เดินทาง', icon: '🚗', color: '#4ECDC4', sortOrder: 2 },
    { name: 'Groceries', nameLocalized: 'ของใช้', icon: '🛒', color: '#45B7D1', sortOrder: 3 },
    { name: 'Utilities', nameLocalized: 'สาธารณูปโภค', icon: '💡', color: '#96CEB4', sortOrder: 4 },
    { name: 'Entertainment', nameLocalized: 'บันเทิง', icon: '🎬', color: '#DDA0DD', sortOrder: 5 },
    { name: 'Shopping', nameLocalized: 'ช้อปปิ้ง', icon: '🛍️', color: '#FFB347', sortOrder: 6 },
    { name: 'Health', nameLocalized: 'สุขภาพ', icon: '💊', color: '#98D8C8', sortOrder: 7 },
    { name: 'Education', nameLocalized: 'การศึกษา', icon: '📚', color: '#F7DC6F', sortOrder: 8 },
    { name: 'Travel', nameLocalized: 'ท่องเที่ยว', icon: '✈️', color: '#85C1E9', sortOrder: 9 },
    { name: 'Housing', nameLocalized: 'ที่อยู่อาศัย', icon: '🏠', color: '#D7BDE2', sortOrder: 10 },
    { name: 'Personal', nameLocalized: 'ส่วนตัว', icon: '👤', color: '#FAD7A0', sortOrder: 11 },
    { name: 'Gift', nameLocalized: 'ของขวัญ', icon: '🎁', color: '#F1948A', sortOrder: 12 },
    { name: 'Other', nameLocalized: 'อื่นๆ', icon: '📦', color: '#BDC3C7', sortOrder: 99 },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: category,
      create: { ...category, isSystem: true },
    });
  }

  console.log(`Seeded ${categories.length} categories`);

  // Seed tax categories (name in English, nameLocalized for Thai users)
  const taxCategories = [
    { name: 'Personal', nameLocalized: 'ส่วนตัว', description: 'Personal expenses', deductible: false },
    { name: 'Medical', nameLocalized: 'การแพทย์', description: 'Medical expenses', deductible: true, maxDeduction: 100000 },
    { name: 'Insurance', nameLocalized: 'ประกัน', description: 'Insurance premiums', deductible: true, maxDeduction: 100000 },
    { name: 'Education', nameLocalized: 'การศึกษา', description: 'Education expenses', deductible: true, maxDeduction: 50000 },
    { name: 'Donation', nameLocalized: 'บริจาค', description: 'Charitable donations', deductible: true },
    { name: 'Business', nameLocalized: 'ธุรกิจ', description: 'Business expenses', deductible: true },
    { name: 'Investment', nameLocalized: 'การลงทุน', description: 'Investment-related', deductible: false },
  ];

  for (const taxCat of taxCategories) {
    await prisma.taxCategory.upsert({
      where: { name: taxCat.name },
      update: taxCat,
      create: taxCat,
    });
  }

  console.log(`Seeded ${taxCategories.length} tax categories`);

  // Create category-tax mappings
  const categoryTaxMappings = [
    { category: 'Health', taxCategory: 'Medical' },
    { category: 'Education', taxCategory: 'Education' },
    { category: 'Gift', taxCategory: 'Donation' },
    { category: 'Other', taxCategory: 'Personal' },
  ];

  for (const mapping of categoryTaxMappings) {
    const category = await prisma.category.findUnique({ where: { name: mapping.category } });
    const taxCategory = await prisma.taxCategory.findUnique({ where: { name: mapping.taxCategory } });

    if (category && taxCategory) {
      await prisma.categoryTaxMapping.upsert({
        where: {
          categoryId_taxCategoryId: {
            categoryId: category.id,
            taxCategoryId: taxCategory.id,
          },
        },
        update: {},
        create: {
          categoryId: category.id,
          taxCategoryId: taxCategory.id,
        },
      });
    }
  }

  console.log('Seeded category-tax mappings');

  console.log('Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
