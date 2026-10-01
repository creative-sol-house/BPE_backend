// scripts/backfillEmployeeEmails.ts
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import mongoose from 'mongoose';
import '../src/model/counter';
import '../src/model/employee';
import '../src/model/role';
import '../src/model/user';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI missing'); process.exit(1); }

  await mongoose.connect(uri);
  console.log('Connected');

  const { default: Employee } = await import('../src/model/employee');
  const { default: User } = await import('../src/model/user');

  // Find employees without an email
  const missing = await Employee.find({
    $or: [
      { email: { $exists: false } },
      { email: null },
      { email: '' },
    ],
  });

  console.log(`Found ${missing.length} employees without email`);

  let fixed = 0;
  let skipped = 0;

  for (const emp of missing) {
    if (!emp.user) {
      console.log(`  ⏭  ${emp.employeeId} ${emp.name} — standalone, no user to copy from`);
      skipped++;
      continue;
    }

    const u = await User.findById(emp.user);
    if (!u?.email) {
      console.log(`  ⚠️  ${emp.employeeId} ${emp.name} — linked user has no email either`);
      skipped++;
      continue;
    }

    emp.email = u.email;
    await emp.save();
    console.log(`  ✓ ${emp.employeeId} ${emp.name} → ${u.email}`);
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });