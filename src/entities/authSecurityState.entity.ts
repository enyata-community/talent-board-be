import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "auth_security_state" })
export class AuthSecurityStateEntity {
  @PrimaryColumn({ type: "text" })
  key: string;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  payload: Record<string, string>;

  @Column({ type: "text", nullable: true })
  binding_hash: string | null;

  @Column({ type: "integer", default: 0 })
  hits: number;

  @Index("IDX_AUTH_SECURITY_STATE_EXPIRY")
  @Column({ type: "timestamptz" })
  expires_at: Date;
}
