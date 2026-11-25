import { CategoriesService } from './categories.service';

describe('CategoriesService file cleanup on cascade delete (Finding 12)', () => {
  it('deletes local images for cascaded subcategories after category deletion commits', async () => {
    const prisma = {
      category: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          name: 'Design',
          subcategories: [
            {
              image:
                '/uploads/images/subcategories/550e8400-e29b-41d4-a716-446655440001.webp',
            },
            { image: null },
            {
              image:
                '/uploads/images/subcategories/550e8400-e29b-41d4-a716-446655440002.webp',
            },
          ],
        }),
        delete: jest.fn().mockResolvedValue({ id: 3 }),
      },
    };
    const redisService = {
      invalidateCategoryCaches: jest.fn().mockResolvedValue(undefined),
    };
    const storage = {
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };

    const service = new CategoriesService(
      prisma as never,
      redisService as never,
      storage as never,
    );

    await service.remove(3);

    expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(storage.deleteImage).toHaveBeenCalledTimes(2);
    expect(storage.deleteImage).toHaveBeenCalledWith(
      '/uploads/images/subcategories/550e8400-e29b-41d4-a716-446655440001.webp',
    );
    expect(storage.deleteImage).toHaveBeenCalledWith(
      '/uploads/images/subcategories/550e8400-e29b-41d4-a716-446655440002.webp',
    );
    expect(redisService.invalidateCategoryCaches).toHaveBeenCalledWith(3);
  });
});
