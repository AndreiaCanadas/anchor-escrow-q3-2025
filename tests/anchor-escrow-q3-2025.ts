import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrowQ32025 } from "../target/types/anchor_escrow_q3_2025";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { randomBytes } from "crypto";
import {
  createMint,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { BN } from "bn.js";

describe("anchor-escrow-q3-2025", () => {
  /// Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider();
  const connection = provider.connection;

  const program = anchor.workspace.anchorEscrowQ32025 as Program<AnchorEscrowQ32025>;

  const wallet = provider.wallet as anchor.Wallet; // This creates a new wallet for the test based on the provider

  const tokenProgram = TOKEN_PROGRAM_ID;

  const seed = new anchor.BN(randomBytes(8));
  const amountA = new anchor.BN(1e9);
  const amountB = new anchor.BN(5e9);

  const taker = Keypair.generate();
  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;

  let makerAtaA: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;

  let takerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;

  let vault: anchor.web3.PublicKey;

  const escrow = PublicKey.findProgramAddressSync([
    Buffer.from("escrow"),
    provider.publicKey.toBuffer(),
    seed.toArrayLike(Buffer, "le", 8),
  ], program.programId)[0];

  it("Airdrop SOL to taker", async () => {
    const tx = await connection.requestAirdrop(taker.publicKey, LAMPORTS_PER_SOL * 1);
    await connection.confirmTransaction(tx);
    console.log("\nAirdrop SOL to taker", tx);
    console.log("Taker balance", (await connection.getBalance(taker.publicKey)));
  })

  it("Initialize mint A and B", async () => {
    mintA = await createMint(connection, wallet.payer, provider.publicKey, null, 9);
    mintB = await createMint(connection, wallet.payer, provider.publicKey, null, 9);

    makerAtaA = (await getOrCreateAssociatedTokenAccount(connection, wallet.payer, mintA, provider.publicKey)).address;
    makerAtaB = getAssociatedTokenAddressSync(mintB, provider.publicKey, false, tokenProgram);

    takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey, false, tokenProgram);
    takerAtaB = (await getOrCreateAssociatedTokenAccount(connection, wallet.payer, mintB, taker.publicKey)).address;

    // allow owner to be a PDA (offcurve)
    vault = getAssociatedTokenAddressSync(mintA, escrow, true, tokenProgram);
  })

  it("Mint to maker and taker", async () => {
    const tx = await mintTo(connection, wallet.payer, mintA, makerAtaA, wallet.payer, 100000000000);
    console.log("\nMint to maker", tx);
    console.log("Maker ATA A balance", (await connection.getTokenAccountBalance(makerAtaA)).value.amount);

    const tx2 = await mintTo(connection, wallet.payer, mintB, takerAtaB, wallet.payer, 100000000000);
    console.log("\nMint to taker", tx2);
    console.log("Taker ATA B balance", (await connection.getTokenAccountBalance(takerAtaB)).value.amount);
  })

  it("Make", async () => {
    // Add your test here.
    const tx = await program.methods
      .make(seed, amountA, amountB)
      .accountsPartial({
        maker: provider.publicKey,
        mintA,
        mintB,
        makerAtaA,
        vault,
        escrow,
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("\nMake instruction executed");
    console.log("Your transaction signature", tx);
    console.log("Vault balance", (await connection.getTokenAccountBalance(vault)).value.amount);
    console.log("Maker ATA A balance", (await connection.getTokenAccountBalance(makerAtaA)).value.amount);
  });

  it("Take", async () => {
    // Add your test here.
    const tx = await program.methods
      .take()
      .accountsPartial({
        maker: provider.publicKey,
        taker: taker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        makerAtaB,
        takerAtaA,
        takerAtaB,
        vault,
        escrow,
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();
    console.log("\Take instruction executed");
    console.log("Your transaction signature", tx);
    console.log("Maker ATA A balance", (await connection.getTokenAccountBalance(makerAtaA)).value.amount);
    console.log("Maker ATA B balance", (await connection.getTokenAccountBalance(makerAtaB)).value.amount);
    console.log("Taker ATA A balance", (await connection.getTokenAccountBalance(takerAtaA)).value.amount);
    console.log("Taker ATA B balance", (await connection.getTokenAccountBalance(takerAtaB)).value.amount);
  });

});
