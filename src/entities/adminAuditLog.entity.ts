import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
@Entity("admin_audit_logs")
@Index("idx_admin_audit_time", ["occurred_at", "id"])
export class AdminAuditLog {
  @PrimaryGeneratedColumn("uuid") id: string;
  @CreateDateColumn({ type: "timestamptz" }) occurred_at: Date;
  @Index("idx_admin_audit_actor")
  @Column({ type: "uuid", nullable: true })
  actor_id: string | null;
  @Column({ type: "varchar", nullable: true }) actor_role: string | null;
  @Index("idx_admin_audit_action") @Column() action: string;
  @Column() outcome: string;
  @Column({ type: "varchar", nullable: true }) target_id: string | null;
  @Column({ type: "varchar", nullable: true }) request_id: string | null;
  @Column({ type: "varchar", nullable: true }) ip_address: string | null;
}
