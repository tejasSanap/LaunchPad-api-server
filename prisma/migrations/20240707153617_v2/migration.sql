/*
  Warnings:

  - A unique constraint covering the columns `[login]` on the table `Users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Deployement" ADD COLUMN     "deployementDomain" TEXT DEFAULT '',
ADD COLUMN     "production" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "sub_domain" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Users_login_key" ON "Users"("login");
