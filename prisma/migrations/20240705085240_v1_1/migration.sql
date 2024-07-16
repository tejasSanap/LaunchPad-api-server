/*
  Warnings:

  - The values [FAil] on the enum `DeployementStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthType" AS ENUM ('LOCAL', 'GITHUB', 'BITBUCKET');

-- AlterEnum
BEGIN;
CREATE TYPE "DeployementStatus_new" AS ENUM ('NOT_STARTED', 'QUEUED', 'IN_PROGRESSS', 'READY', 'FAIL');
ALTER TABLE "Deployement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Deployement" ALTER COLUMN "status" TYPE "DeployementStatus_new" USING ("status"::text::"DeployementStatus_new");
ALTER TYPE "DeployementStatus" RENAME TO "DeployementStatus_old";
ALTER TYPE "DeployementStatus_new" RENAME TO "DeployementStatus";
DROP TYPE "DeployementStatus_old";
ALTER TABLE "Deployement" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';
COMMIT;

-- CreateTable
CREATE TABLE "Users" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "authType" "AuthType" NOT NULL,
    "authId" TEXT NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);
