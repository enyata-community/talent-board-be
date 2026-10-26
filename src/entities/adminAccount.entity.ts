import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { UserEntity } from "./user.entity";
export enum AdminRole {
  ADMIN = "admin",
  SUPER_ADMIN = "super_admin",
}
export enum AdminStatus {
  PENDING = "pending",
  ACTIVE = "active",
  DISABLED = "disabled",
}
@Entity("admin_accounts")
@Check("CK_admin_status", "status IN ('pending', 'active', 'disabled')")
export class AdminAccount {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Column("uuid") user_id: string;
  @OneToOne(() => UserEntity, {
    eager: true,
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({
    name: "user_id",
    foreignKeyConstraintName: "fk_admin_account_user",
  })
  user: UserEntity;
  @Column({ type: "varchar", default: AdminStatus.PENDING })
  status: AdminStatus;
  @Column({ type: "timestamptz", nullable: true }) password_set_at: Date | null;
  @Column({ type: "timestamptz", nullable: true }) last_login_at: Date | null;
  @CreateDateColumn({ type: "timestamptz" }) created_at: Date;
  @UpdateDateColumn({ type: "timestamptz" }) updated_at: Date;
  // Derived accessors keep the portal DTO stable; no duplicate identity columns.
  get email(): string {
    return this.user?.email;
  }
  get role(): AdminRole {
    return this.user?.role as unknown as AdminRole;
  }
  get display_name(): string | null {
    return (
      [this.user?.first_name, this.user?.last_name].filter(Boolean).join(" ") ||
      null
    );
  }
}
