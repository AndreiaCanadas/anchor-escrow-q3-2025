#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
mod instructions;
mod state;
use instructions::*;

declare_id!("C8TTYzo2y6YWak5ccePwfbKnP3e4Kr55mRsv4hEQp4DQ");

#[program]
pub mod anchor_escrow_q3_2025 {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, amount_a: u64, amount_b: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, amount_b, &ctx.bumps)?;
        ctx.accounts.deposit(amount_a)
    }

    pub fn take(ctx: Context<Take>) -> Result<()> { 
        ctx.accounts.transfer_to_maker()?;
        ctx.accounts.transfer_to_taker_and_close_vault()
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close_vault()
    }
}

