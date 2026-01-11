-- CreateTable
CREATE TABLE "nguoi_dung" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passWord" TEXT,
    "phone" TEXT,
    "birthDay" TEXT,
    "gender" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "skill" TEXT,
    "certification" TEXT,
    "googleId" TEXT,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nguoi_dung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loai_cong_viec" (
    "id" SERIAL NOT NULL,
    "tenLoaiCongViec" TEXT NOT NULL,

    CONSTRAINT "loai_cong_viec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chi_tiet_loai_cong_viec" (
    "id" SERIAL NOT NULL,
    "tenChiTiet" TEXT NOT NULL,
    "hinhAnh" TEXT,
    "maLoaiCongViec" INTEGER NOT NULL,

    CONSTRAINT "chi_tiet_loai_cong_viec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cong_viec" (
    "id" SERIAL NOT NULL,
    "tenCongViec" TEXT NOT NULL,
    "danhGia" INTEGER NOT NULL DEFAULT 0,
    "giaTien" INTEGER NOT NULL,
    "hinhAnh" TEXT,
    "moTa" TEXT,
    "moTaNgan" TEXT,
    "saoCongViec" INTEGER NOT NULL DEFAULT 0,
    "maChiTietLoai" INTEGER NOT NULL,
    "nguoiTao" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cong_viec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binh_luan" (
    "id" SERIAL NOT NULL,
    "maCongViec" INTEGER NOT NULL,
    "maNguoiBinhLuan" INTEGER NOT NULL,
    "ngayBinhLuan" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noiDung" TEXT NOT NULL,
    "saoBinhLuan" INTEGER NOT NULL,

    CONSTRAINT "binh_luan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thue_cong_viec" (
    "id" SERIAL NOT NULL,
    "maCongViec" INTEGER NOT NULL,
    "maNguoiThue" INTEGER NOT NULL,
    "ngayThue" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoanThanh" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "thue_cong_viec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nguoi_dung_email_key" ON "nguoi_dung"("email");

-- CreateIndex
CREATE UNIQUE INDEX "nguoi_dung_googleId_key" ON "nguoi_dung"("googleId");

-- AddForeignKey
ALTER TABLE "chi_tiet_loai_cong_viec" ADD CONSTRAINT "chi_tiet_loai_cong_viec_maLoaiCongViec_fkey" FOREIGN KEY ("maLoaiCongViec") REFERENCES "loai_cong_viec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cong_viec" ADD CONSTRAINT "cong_viec_maChiTietLoai_fkey" FOREIGN KEY ("maChiTietLoai") REFERENCES "chi_tiet_loai_cong_viec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binh_luan" ADD CONSTRAINT "binh_luan_maCongViec_fkey" FOREIGN KEY ("maCongViec") REFERENCES "cong_viec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binh_luan" ADD CONSTRAINT "binh_luan_maNguoiBinhLuan_fkey" FOREIGN KEY ("maNguoiBinhLuan") REFERENCES "nguoi_dung"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thue_cong_viec" ADD CONSTRAINT "thue_cong_viec_maCongViec_fkey" FOREIGN KEY ("maCongViec") REFERENCES "cong_viec"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thue_cong_viec" ADD CONSTRAINT "thue_cong_viec_maNguoiThue_fkey" FOREIGN KEY ("maNguoiThue") REFERENCES "nguoi_dung"("id") ON DELETE CASCADE ON UPDATE CASCADE;
