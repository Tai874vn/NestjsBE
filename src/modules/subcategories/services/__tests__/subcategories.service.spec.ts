import { SubcategoriesService } from '../subcategories.service';

describe('SubcategoriesService cache invalidations', () => {
  const createService = () => {
    const prisma = {
      subcategory: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const redisService = {
      invalidateCategoryCaches: jest.fn().mockResolvedValue(undefined),
    };
    const storage = {
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SubcategoriesService(
      prisma as never,
      redisService as never,
      storage as never,
    );
    return { service, prisma, redisService, storage };
  };

  it('invalidates both old and new categoryId when a subcategory moves categories', async () => {
    const { service, prisma, redisService } = createService();
    prisma.subcategory.findUnique.mockResolvedValue({
      id: 10,
      name: 'Logo Design',
      categoryId: 2,
    });
    prisma.subcategory.update.mockResolvedValue({
      id: 10,
      name: 'Logo Design',
      categoryId: 5,
    });

    await service.update(10, { categoryId: 5 });

    expect(redisService.invalidateCategoryCaches).toHaveBeenCalledTimes(2);
    expect(redisService.invalidateCategoryCaches).toHaveBeenNthCalledWith(1, 2);
    expect(redisService.invalidateCategoryCaches).toHaveBeenNthCalledWith(2, 5);
  });

  it('invalidates only once when categoryId does not change', async () => {
    const { service, prisma, redisService } = createService();
    prisma.subcategory.findUnique.mockResolvedValue({
      id: 10,
      name: 'Logo Design',
      categoryId: 2,
    });
    prisma.subcategory.update.mockResolvedValue({
      id: 10,
      name: 'Brand Logo Design',
      categoryId: 2,
    });

    await service.update(10, { name: 'Brand Logo Design' });

    expect(redisService.invalidateCategoryCaches).toHaveBeenCalledTimes(1);
    expect(redisService.invalidateCategoryCaches).toHaveBeenCalledWith(2);
  });

  it('deletes the previous local image when update replaces subcategory.image (Finding 12)', async () => {
    const { service, prisma, storage } = createService();
    const oldImage =
      '/uploads/images/subcategories/550e8400-e29b-41d4-a716-446655440001.webp';
    const nextImage =
      '/uploads/images/subcategories/550e8400-e29b-41d4-a716-446655440002.webp';
    prisma.subcategory.findUnique.mockResolvedValue({
      id: 10,
      name: 'Logo Design',
      categoryId: 2,
      image: oldImage,
    });
    prisma.subcategory.update.mockResolvedValue({
      id: 10,
      name: 'Logo Design',
      categoryId: 2,
      image: nextImage,
    });

    await service.update(10, { image: nextImage });

    expect(storage.deleteImage).toHaveBeenCalledWith(oldImage);
  });
});
