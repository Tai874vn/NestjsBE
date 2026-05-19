CREATE TABLE "user_resumes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "sourceFileName" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_resumes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_resumes_userId_key" ON "user_resumes"("userId");

ALTER TABLE "user_resumes" ADD CONSTRAINT "user_resumes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
