const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Move src to src_backup
if (fs.existsSync('src')) fs.renameSync('src', 'src_backup');

// 2. Move dist to src
if (fs.existsSync('dist')) fs.renameSync('dist', 'src');

// 3. Compile prisma/seed.ts if exists
if (fs.existsSync('prisma/seed.ts')) {
  try { execSync('npx tsc prisma/seed.ts --skipLibCheck'); } catch (e) {}
  if (fs.existsSync('prisma/seed.js')) {
    fs.unlinkSync('prisma/seed.ts');
  }
}
if (fs.existsSync('prisma/seed-production.ts')) {
  try { execSync('npx tsc prisma/seed-production.ts --skipLibCheck'); } catch (e) {}
  if (fs.existsSync('prisma/seed-production.js')) {
    fs.unlinkSync('prisma/seed-production.ts');
  }
}

// 4. Update package.json
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

pkg.scripts.dev = 'node --watch src/server.js';
pkg.scripts.start = 'node src/server.js';
pkg.scripts.build = 'echo "No build required"';
pkg.scripts['prisma:seed'] = 'node prisma/seed.js';
pkg.scripts['prisma:seed:production'] = 'node prisma/seed-production.js';
pkg.prisma.seed = 'node prisma/seed.js';

// Remove typescript and ts-node/tsx dependencies
const depsToRemove = ['typescript', 'tsx', 'ts-node', '@types/node', '@types/express', '@types/cookie-parser', '@types/cors', '@types/jsonwebtoken', '@types/multer', '@types/nodemailer', '@types/pdfkit', '@types/supertest', '@types/swagger-ui-express', 'vitest'];
if (pkg.devDependencies) {
  depsToRemove.forEach(dep => delete pkg.devDependencies[dep]);
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');

// 5. Remove tsconfig.json
if (fs.existsSync('tsconfig.json')) fs.unlinkSync('tsconfig.json');
if (fs.existsSync('tsconfig.build.json')) fs.unlinkSync('tsconfig.build.json');
if (fs.existsSync('vitest.config.ts')) fs.unlinkSync('vitest.config.ts');

console.log('Conversion to JavaScript complete.');
