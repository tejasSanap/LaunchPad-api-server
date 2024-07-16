/*
  Warnings:

  - A unique constraint covering the columns `[authId]` on the table `Users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Users_authId_key" ON "Users"("authId");
