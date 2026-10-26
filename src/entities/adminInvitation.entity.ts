import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { AdminAccount } from "./adminAccount.entity";
@Entity("admin_invitations")
@Check(
  "CK_admin_invitation_delivery",
  "delivery_status IN ('pending', 'sent', 'failed')",
)
@Index("UQ_admin_invitation_open", ["admin_account_id"], {
  unique: true,
  where: '"accepted_at" IS NULL AND "revoked_at" IS NULL',
})
export class AdminInvitation {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Column("uuid") admin_account_id: string;
  @ManyToOne(() => AdminAccount, { onDelete: "RESTRICT" })
  @JoinColumn({
    name: "admin_account_id",
    foreignKeyConstraintName: "admin_invitations_admin_account_id_fkey",
  })
  account: AdminAccount;
  @Column({ type: "uuid", nullable: true }) invited_by_admin_id: string | null;
  @ManyToOne(() => AdminAccount, { onDelete: "RESTRICT" })
  @JoinColumn({
    name: "invited_by_admin_id",
    foreignKeyConstraintName: "admin_invitations_invited_by_admin_id_fkey",
  })
  invited_by: AdminAccount;
  @Index("uq_admin_invitation_hash", { unique: true })
  @Column({ select: false })
  token_hash: string;
  @Column({ type: "timestamptz" }) expires_at: Date;
  @Column({ type: "timestamptz", nullable: true }) accepted_at: Date | null;
  @Column({ type: "timestamptz", nullable: true }) revoked_at: Date | null;
  @Column({ default: "pending" }) delivery_status: string;
  @CreateDateColumn({ type: "timestamptz" }) created_at: Date;
}
