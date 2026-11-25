-- Top-ups move from VNPay to SePay. Old rows are marked VNPAY and keep their VNPay fields.
ALTER TABLE "top_ups" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'VNPAY';
ALTER TABLE "top_ups" ALTER COLUMN "provider" SET DEFAULT 'SEPAY';
ALTER TABLE "top_ups" ADD COLUMN "gatewayTransactionId" TEXT;
ALTER TABLE "top_ups" ADD COLUMN "paymentMethod" TEXT;
