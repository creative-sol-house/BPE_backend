const mongoose = require('mongoose');
const dotenv =require('dotenv') ;
dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');

  await mongoose.connect(uri);
  console.log('Connected.');

  const coll = mongoose.connection.collection('employees');

  const before = await coll.countDocuments({
    $or: [
      { salaryStructure: { $exists: false } },
      { basicSalary: { $exists: false } },
      { pieceRateSalary: { $exists: false } },
      { overtimePerHourAmount: { $exists: false } },
    ],
  });
  console.log(`Documents needing backfill: ${before}`);

  const result = await coll.updateMany(
    {},
    [
      {
        $set: {
          salaryStructure: { $ifNull: ['$salaryStructure', 'fixed'] },
          basicSalary: { $ifNull: ['$basicSalary', 0] },
          pieceRateSalary: { $ifNull: ['$pieceRateSalary', 0] },
          overtimePerHourAmount: { $ifNull: ['$overtimePerHourAmount', 0] },
        },
      },
    ]
  );

  console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});