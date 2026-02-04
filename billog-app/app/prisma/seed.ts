import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed categories
  const categories = [
    { name: 'Food', nameTh: 'อาหาร', icon: '🍔', color: '#FF6B6B', sortOrder: 1 },
    { name: 'Transport', nameTh: 'เดินทาง', icon: '🚗', color: '#4ECDC4', sortOrder: 2 },
    { name: 'Groceries', nameTh: 'ของใช้', icon: '🛒', color: '#45B7D1', sortOrder: 3 },
    { name: 'Utilities', nameTh: 'สาธารณูปโภค', icon: '💡', color: '#96CEB4', sortOrder: 4 },
    { name: 'Entertainment', nameTh: 'บันเทิง', icon: '🎬', color: '#DDA0DD', sortOrder: 5 },
    { name: 'Shopping', nameTh: 'ช้อปปิ้ง', icon: '🛍️', color: '#FFB347', sortOrder: 6 },
    { name: 'Health', nameTh: 'สุขภาพ', icon: '💊', color: '#98D8C8', sortOrder: 7 },
    { name: 'Education', nameTh: 'การศึกษา', icon: '📚', color: '#F7DC6F', sortOrder: 8 },
    { name: 'Travel', nameTh: 'ท่องเที่ยว', icon: '✈️', color: '#85C1E9', sortOrder: 9 },
    { name: 'Housing', nameTh: 'ที่อยู่อาศัย', icon: '🏠', color: '#D7BDE2', sortOrder: 10 },
    { name: 'Personal', nameTh: 'ส่วนตัว', icon: '👤', color: '#FAD7A0', sortOrder: 11 },
    { name: 'Gift', nameTh: 'ของขวัญ', icon: '🎁', color: '#F1948A', sortOrder: 12 },
    { name: 'Other', nameTh: 'อื่นๆ', icon: '📦', color: '#BDC3C7', sortOrder: 99 },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: category,
      create: { ...category, isSystem: true },
    });
  }

  console.log(`Seeded ${categories.length} categories`);

  // Seed tax categories
  const taxCategories = [
    { name: 'Personal', nameTh: 'ส่วนตัว', description: 'Personal expenses', deductible: false },
    { name: 'Medical', nameTh: 'การแพทย์', description: 'Medical expenses', deductible: true, maxDeduction: 100000 },
    { name: 'Insurance', nameTh: 'ประกัน', description: 'Insurance premiums', deductible: true, maxDeduction: 100000 },
    { name: 'Education', nameTh: 'การศึกษา', description: 'Education expenses', deductible: true, maxDeduction: 50000 },
    { name: 'Donation', nameTh: 'บริจาค', description: 'Charitable donations', deductible: true },
    { name: 'Business', nameTh: 'ธุรกิจ', description: 'Business expenses', deductible: true },
    { name: 'Investment', nameTh: 'การลงทุน', description: 'Investment-related', deductible: false },
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
