// cron/cleanupPendingUsers.ts
import cron from 'node-cron';
import PendingUser from '../model/pendingUser';
import OTP from '../model/OTP';

const UNVERIFIED_MAX_AGE_MINUTES = 30;

export async function cleanupUnverifiedPendingUsers(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - UNVERIFIED_MAX_AGE_MINUTES * 60 * 1000);

    // Find candidates first, so we can log them and clean up their OTPs too
    const stalePendingUsers = await PendingUser.find({
      isEmailVerified: false,
      createdAt: { $lt: cutoff },
    }).select('_id email createdAt');

    if (stalePendingUsers.length === 0) {
      console.log('🧹 [cleanup] No stale unverified registrations found.');
      return;
    }

    const emails = stalePendingUsers.map((u) => u.email);
    const ids = stalePendingUsers.map((u) => u._id);

    // Delete the pending users
    const userResult = await PendingUser.deleteMany({ _id: { $in: ids } });

    // Delete any lingering OTPs for those emails
    const otpResult = await OTP.deleteMany({ email: { $in: emails } });

    console.log(
      `🧹 [cleanup] Deleted ${userResult.deletedCount} stale pending user(s) and ${otpResult.deletedCount} OTP(s).`
    );
    stalePendingUsers.forEach((u) => {
      console.log(`   • ${u.email} (created ${u.createdAt?.toISOString()})`);
    });
  } catch (err: any) {
    console.error('❌ [cleanup] Failed:', err.message);
  }
}

export function startCleanupCron(): void {
  // Runs at minute 0 of every 6th hour: 00:00, 06:00, 12:00, 18:00
  cron.schedule('0 */6 * * *', async () => {
    console.log('🧹 [cleanup] Cron triggered at', new Date().toISOString());
    await cleanupUnverifiedPendingUsers();
  });

  console.log('⏰ [cron] Pending-user cleanup scheduled (every 6 hours).');
}