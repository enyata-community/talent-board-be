import { Brackets } from "typeorm";
import AppDataSource from "../datasource";
import { ConversationThreadEntity } from "../entities/conversationThread.entity";
import { SavedTalentEntity } from "../entities/savedTalent.entity";
import { UserEntity, UserRole } from "../entities/user.entity";
import { NotFoundError } from "../exceptions/notFoundError";
import { resolveAssetUrl } from "../utils/resolveAssetUrl";
import { AdminUsersQuery } from "./schemas/adminUsers.schema";

const accountFields = [
  "id",
  "first_name",
  "last_name",
  "email",
  "role",
  "status",
  "avatar",
  "created_at",
  "last_activity_at",
  "profile_completed",
  "is_email_verified",
  "provider",
  "state",
  "country",
  "linkedin_profile",
] as const;

export const adminUserDto = (user: UserEntity) => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  account_type: user.role,
  status: user.status,
  avatar: resolveAssetUrl(user.avatar),
  joined_at: user.created_at,
  last_activity_at: user.last_activity_at ?? null,
  profile_completed: user.profile_completed,
  is_email_verified: user.is_email_verified,
  provider: user.provider,
  state: user.state,
  country: user.country,
  linkedin_profile: user.linkedin_profile,
});

const counterpartDto = (user: UserEntity) => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  account_type: user.role,
  status: user.status,
});

export class AdminUsersService {
  private accounts() {
    return AppDataSource.getRepository(UserEntity)
      .createQueryBuilder("account")
      .select(accountFields.map((field) => `account.${field}`))
      .where("account.role IN (:...roles)", {
        roles: [UserRole.TALENT, UserRole.RECRUITER],
      });
  }

  // List users with optional filtering, sorting, and pagination.
  async list(query: AdminUsersQuery) {
    const qb = this.accounts();
    if (query.account_type)
      qb.andWhere("account.role = :role", { role: query.account_type });
    if (query.status)
      qb.andWhere("account.status = :status", { status: query.status });
    if (query.search) {
      // Treat SQL wildcard characters as literal search text.
      const search = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
      qb.andWhere(
        new Brackets((where) => {
          where
            .where("account.email ILIKE :search", { search })
            .orWhere(
              "concat_ws(' ', account.first_name, account.last_name) ILIKE :search",
              { search },
            );
        }),
      );
    }
    const direction = query.sort_order === "asc" ? "ASC" : "DESC";
    qb.orderBy(
      query.sort_by === "last_activity"
        ? "account.last_activity_at"
        : "account.created_at",
      direction,
      "NULLS LAST",
    )
      .addOrderBy("account.id", direction)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [entities, total] = await qb.getManyAndCount();
    return {
      items: entities.map(adminUserDto),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async detail(id: string, page = 1, limit = 10) {
    const user = await this.accounts()
      .andWhere("account.id = :id", { id })
      .leftJoinAndSelect("account.talent_profile", "talent_profile")
      .leftJoinAndSelect("talent_profile.skills", "skill")
      .leftJoinAndSelect("account.recruiter_profile", "recruiter_profile")
      .getOne();
    if (!user) throw new NotFoundError("User account not found");

    const isTalent = user.role === UserRole.TALENT;
    const side = isTalent ? "talent" : "recruiter";
    const other = isTalent ? "recruiter" : "talent";
    const connectionsQuery = AppDataSource.getRepository(
      ConversationThreadEntity,
    )
      .createQueryBuilder("connection")
      .innerJoinAndSelect(`connection.${other}`, "counterpart")
      .where(`connection.${side}_id = :id`, { id })
      .orderBy("connection.created_at", "DESC")
      .addOrderBy("connection.id", "DESC")
      .skip((page - 1) * limit)
      .take(limit);
    const pipelineQuery = AppDataSource.getRepository(SavedTalentEntity)
      .createQueryBuilder("saved")
      .innerJoinAndSelect(`saved.${other}`, "counterpart")
      .where(`saved.${side}_id = :id`, { id })
      .orderBy("saved.saved_at", "DESC")
      .addOrderBy("saved.id", "DESC")
      .skip((page - 1) * limit)
      .take(limit);
    const [[connections, connectionTotal], [pipeline, pipelineTotal]] =
      await Promise.all([
        connectionsQuery.getManyAndCount(),
        pipelineQuery.getManyAndCount(),
      ]);
    const talent = user.talent_profile;
    const recruiter = user.recruiter_profile;
    const profile = isTalent
      ? talent
        ? {
            bio: talent.bio,
            job_title: talent.job_title,
            experience_level: talent.experience_level,
            profile_status: talent.profile_status,
            portfolio_url: talent.portfolio_url,
            skills: talent.skills.map((skill) => ({
              id: skill.id,
              name: skill.name,
            })),
            has_resume: Boolean(talent.resume_path),
          }
        : null
      : recruiter
        ? {
            work_email: recruiter.work_email,
            company_industry: recruiter.company_industry,
            roles_looking_for: recruiter.roles_looking_for,
            hiring_for: recruiter.hiring_for,
          }
        : null;
    return {
      ...adminUserDto(user),
      profile,
      active_connections: {
        items: connections.map((connection) => ({
          id: connection.id,
          connected_at: connection.created_at,
          latest_message_at: connection.latest_message_at,
          user: counterpartDto(connection[other]),
        })),
        total: connectionTotal,
        page,
        limit,
      },
      pipeline_relationships: {
        items: pipeline.map((saved) => ({
          id: saved.id,
          stage: "saved" as const,
          saved_at: saved.saved_at,
          user: counterpartDto(saved[other]),
        })),
        total: pipelineTotal,
        page,
        limit,
      },
      interview_scheduling: { available: false as const, status: null },
    };
  }
}
