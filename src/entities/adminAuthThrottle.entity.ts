import { Column, Entity, PrimaryColumn } from "typeorm";
@Entity("admin_auth_throttles")
export class AdminAuthThrottle {
  @PrimaryColumn() key: string;
  @Column({ type: "int" }) attempts: number;
  @Column({ type: "timestamptz" }) expires_at: Date;
}
