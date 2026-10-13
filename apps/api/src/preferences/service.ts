import pg from 'pg';
import { PreferencesSchema, type Preferences } from '@klaro/contracts';

interface PreferenceRow {
  native_language: string;
  writing_languages: string[];
  active_writing_language: string;
  style: string;
  proficiency: string | null;
}

function mapped(row: PreferenceRow): Preferences {
  return PreferencesSchema.parse({ version: 'v1', nativeLanguage: row.native_language, writingLanguages: row.writing_languages, activeWritingLanguage: row.active_writing_language, style: row.style, proficiency: row.proficiency });
}

export class PreferencesService {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) { this.pool = new pg.Pool({ connectionString, max: 5 }); }

  async get(userId: string): Promise<Preferences | undefined> {
    const result = await this.pool.query<PreferenceRow>("SELECT p.* FROM klaro.user_preferences p JOIN klaro.users u ON u.id = p.user_id WHERE p.user_id = $1 AND u.status = 'active'", [userId]);
    return result.rows[0] ? mapped(result.rows[0]) : undefined;
  }

  async update(userId: string, preferences: Preferences): Promise<Preferences | undefined> {
    const value = PreferencesSchema.parse(preferences);
    const result = await this.pool.query<PreferenceRow>(
      "UPDATE klaro.user_preferences p SET native_language = $2, writing_languages = $3, active_writing_language = $4, style = $5, proficiency = $6, updated_at = now() FROM klaro.users u WHERE p.user_id = $1 AND u.id = p.user_id AND u.status = 'active' RETURNING p.*",
      [userId, value.nativeLanguage, value.writingLanguages, value.activeWritingLanguage, value.style, value.proficiency],
    );
    return result.rows[0] ? mapped(result.rows[0]) : undefined;
  }
}
