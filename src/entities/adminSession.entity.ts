import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { AdminAccount } from "./adminAccount.entity";
@Entity("admin_sessions")
export class AdminSession {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Index("idx_admin_session_account") @Column("uuid") admin_account_id: string;
  @ManyToOne(() => AdminAccount, { onDelete: "CASCADE" })
  @JoinColumn({
    name: "admin_account_id",
    foreignKeyConstraintName: "admin_sessions_admin_account_id_fkey",
  })
  account: AdminAccount;
  @Index("uq_admin_session_hash", { unique: true })
  @Column({ select: false })
  token_hash: string;
  @Column({ select: false }) csrf_token: string;
  @CreateDateColumn({ type: "timestamptz" }) created_at: Date;
  @Column({ type: "timestamptz" }) last_seen_at: Date;
  @Column({ type: "timestamptz" }) idle_expires_at: Date;
  @Index("idx_admin_session_expiry")
  @Column({ type: "timestamptz" })
  expires_at: Date;
  @Column({ type: "timestamptz", nullable: true }) revoked_at: Date | null;
}
