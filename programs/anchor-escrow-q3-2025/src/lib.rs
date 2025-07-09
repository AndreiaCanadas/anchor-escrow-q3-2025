use anchor_lang::prelude::*;

declare_id!("C8TTYzo2y6YWak5ccePwfbKnP3e4Kr55mRsv4hEQp4DQ");

#[program]
pub mod anchor_escrow_q3_2025 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
