# Anchor Escrow Q3 2025

This program implements an escrow contract compatible with both SPL Token and SPL Token 2022, using the TokenInterface for flexibility.

A maker creates an escrow by depositing a specified amount (`amount_a`) of tokens of type `mint_a` into a secure vault. In return, the maker requests a certain amount (`amount_b`) of tokens of type `mint_b`. Any taker can fulfill the escrow by providing the required `mint_b` tokens, upon which they will atomically receive the vaulted `mint_a` tokens in exchange.

**Note:** In this implementation, both tokens must be issued by the same token program. If you want an example that can have token swap from different programs, see: https://github.com/AndreiaCanadas/anchor-escrow-interface.

---

## Architecture

The Escrow state account consists of:

```rust
#[account]
pub struct Escrow {
    pub seed: u64,               // seed to allow each maker to have multiple escrows
    pub maker: Pubkey,           // maker of the escrow
    pub mint_a: Pubkey,          // mint of the token being deposited
    pub mint_b: Pubkey,          // mint of the token being received
    pub amount: u64,             // amount that the maker wants to receive (mint_b)
    pub bump: u8,                // bump of the escrow PDA
}
```

The Escrow account stores:

- `seed`: Unique identifier allowing each maker to create multiple escrows
- `maker`: The user initiating the escrow
- `mint_a`: The token being deposited into the vault
- `mint_b`: The token the maker wants to receive
- `amount`: The amount of mint_b the maker wants to receive
- `bump`: The PDA bump seed

The Escrow account is derived as a PDA from "escrow", the maker's public key, and the seed value.

---

### Make Instruction

The maker creates an escrow with the following context:

```rust
#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Make<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_b: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_ata_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = maker,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = maker,
        space = Escrow::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

Accounts:

- `maker`: Signer creating the escrow (mutable)
- `mint_a`: Mint of the token being deposited (supports SPL Token and Token 2022)
- `mint_b`: Mint of the token the maker wants to receive (supports SPL Token and Token 2022)
- `maker_ata_a`: Maker's ATA for mint_a (mutable, tokens transferred from here)
- `vault`: ATA owned by the escrow PDA to hold mint_a until exchange completes
- `escrow`: Escrow state account (PDA derived from "escrow", maker key, and seed)
- `token_program`: Token program interface supporting both SPL Token and Token 2022
- `associated_token_program`: Associated token program
- `system_program`: System program

### Implementation

```rust
impl<'info> Make<'info> {
    pub fn init_escrow(&mut self, seed: u64, amount_b: u64, bumps: &MakeBumps) -> Result<()> {
        self.escrow.set_inner(Escrow {
            seed,
            maker: self.maker.key(),
            mint_a: self.mint_a.key(),
            mint_b: self.mint_b.key(),
            amount: amount_b,
            bump: bumps.escrow,
        });

        Ok(())
    }

    pub fn deposit(&mut self, amount_a: u64) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: self.maker_ata_a.to_account_info(),
            mint: self.mint_a.to_account_info(),
            to: self.vault.to_account_info(),
            authority: self.maker.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer_checked(cpi_ctx, amount_a, self.mint_a.decimals)
    }
}
```

`init_escrow` initializes the escrow account with the exchange conditions. `deposit` transfers tokens from the maker's ATA to the vault using `transfer_checked` for enhanced security.

---

### Take Instruction

The taker completes the escrow exchange with the following context:

```rust
#[derive(Accounts)]
pub struct Take<'info> {
    #[account(mut)]
    pub maker: SystemAccount<'info>,

    #[account(mut)]
    pub taker: Signer<'info>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_b: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        close = taker,
        has_one = maker,
        has_one = mint_a,
        has_one = mint_b,
        seeds = [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_b,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_ata_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program,
    )]
    pub taker_ata_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
        associated_token::token_program = token_program,
    )]
    pub taker_ata_a: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

Accounts:

- `maker`: Account of the escrow creator
- `taker`: Signer accepting the exchange (mutable)
- `mint_a`: Mint of the token being received by taker
- `mint_b`: Mint of the token being sent by taker
- `escrow`: Escrow state account (closed after exchange, rent returned to taker)
- `vault`: Vault holding mint_a until exchange completes (mutable)
- `maker_ata_b`: Maker's ATA for mint_b (init_if_needed)
- `taker_ata_b`: Taker's ATA for mint_b (mutable, tokens transferred from here)
- `taker_ata_a`: Taker's ATA for mint_a (init_if_needed)
- `token_program`: Token program interface
- `associated_token_program`: Associated token program
- `system_program`: System program

### Implementation

```rust
impl<'info> Take<'info> {
    pub fn transfer_to_maker(&mut self) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: self.taker_ata_b.to_account_info(),
            mint: self.mint_b.to_account_info(),
            to: self.maker_ata_b.to_account_info(),
            authority: self.taker.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        let amount = self.escrow.amount;
        transfer_checked(cpi_ctx, amount, self.mint_b.decimals)
    }

    pub fn transfer_to_taker_and_close_vault(&mut self) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            mint: self.mint_a.to_account_info(),
            to: self.taker_ata_a.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        let signer_seeds: [&[&[u8]]; 1] = [&[
            b"escrow",
            self.maker.to_account_info().key.as_ref(),
            &self.escrow.seed.to_le_bytes()[..],
            &[self.escrow.bump],
        ]];
        let transfer_cpi_ctx = CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts, &signer_seeds);
        let amount = self.vault.amount;
        transfer_checked(transfer_cpi_ctx, amount, self.mint_a.decimals)?;

        let close_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.maker.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        let close_cpi_ctx = CpiContext::new_with_signer(cpi_program, close_accounts, &signer_seeds);
        close_account(close_cpi_ctx)
    }
}
```

`transfer_to_maker` transfers mint_b from taker to maker. `transfer_to_taker_and_close_vault` transfers all mint_a from the vault to the taker and closes the vault account in a single function for efficiency. Since the vault authority is the escrow PDA, signer seeds are required for the CPI.

---

### Refund Instruction

The maker can refund their tokens and close the escrow if no exchange has occurred:

```rust
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mint::token_program = token_program,
    )]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_ata_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        close = maker,
        has_one = maker,
        has_one = mint_a,
        seeds = [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

### Implementation

```rust
impl<'info> Refund<'info> {
    pub fn refund_and_close_vault(&mut self) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();
        let transfer_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            mint: self.mint_a.to_account_info(),
            to: self.maker_ata_a.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        let signer_seeds: [&[&[u8]]; 1] = [&[
            b"escrow",
            self.maker.to_account_info().key.as_ref(),
            &self.escrow.seed.to_le_bytes()[..],
            &[self.escrow.bump],
        ]];
        let refund_cpi_ctx = CpiContext::new_with_signer(cpi_program.clone(), transfer_accounts, &signer_seeds);
        let amount = self.vault.amount;
        transfer_checked(refund_cpi_ctx, amount, self.mint_a.decimals)?;

        let close_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.maker.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        let close_cpi_ctx = CpiContext::new_with_signer(cpi_program, close_accounts, &signer_seeds);
        close_account(close_cpi_ctx)
    }
}
```

`refund_and_close_vault` transfers all tokens from the vault back to the maker and closes the vault account, returning rent to the maker. The function combines both operations for efficiency.

---

### Program Instructions

```rust
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
```

The `make` instruction initializes the escrow account and transfers tokens from the maker to the vault.

The `take` instruction transfers mint_b from taker to maker, then transfers mint_a from vault to taker and closes the vault account.

The `refund` instruction allows the maker to reclaim their tokens and close the vault if the exchange hasn't occurred yet.
