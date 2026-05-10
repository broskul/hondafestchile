const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const { lastSupabaseWarning, readState, storageMode, supabaseConfigured } = require("../server/lib/storage");

async function main() {
  if (!supabaseConfigured()) {
    console.log("Supabase no esta configurado. La app usara JSON local.");
    return;
  }

  const state = await readState();
  console.log(
    JSON.stringify(
      {
        mode: storageMode(),
        users: state.users.length,
        orders: state.orders.length,
        tickets: state.tickets.length,
        warning: lastSupabaseWarning()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
