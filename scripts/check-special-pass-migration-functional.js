const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const schemaPath = path.join(process.cwd(), "supabase", "schema.sql");
const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260905120000_special_pass_upgrades.sql"
);

// PGlite no distribuye pgcrypto. El contrato funcional conserva todo el SQL
// salvo CREATE EXTENSION y reemplaza digest() solo dentro de la base efimera.
function withoutPgcryptoExtension(sql) {
  return sql.replace(/create extension if not exists pgcrypto;\s*/gi, "");
}

async function expectDatabaseError(action, expectedMessage) {
  try {
    await action();
    assert.fail(`Se esperaba error: ${expectedMessage}`);
  } catch (error) {
    assert.match(String(error.message || error), expectedMessage);
  }
}

async function main() {
  const db = new PGlite();
  try {
    await db.exec(withoutPgcryptoExtension(fs.readFileSync(schemaPath, "utf8")));
    await db.exec(`
      create role service_role bypassrls;
      grant usage on schema public to service_role;

      create function public.digest(input_value text, algorithm text)
      returns bytea
      language sql
      immutable
      as $$
        select decode(md5(input_value) || md5(input_value || algorithm), 'hex')
      $$;
    `);

    // Demuestra que una configuracion previamente activa queda desactivada sin
    // perder campos ajenos al kill-switch.
    await db.exec(`
      insert into public.hfc_settings (id, type, payload)
      values (
        'special_pass_config',
        'special_pass',
        '{"active":true,"rulesPublished":true,"eventDate":"2026-11-28","customPreserved":"yes"}'::jsonb
      );
    `);

    const migrationSql = withoutPgcryptoExtension(fs.readFileSync(migrationPath, "utf8"));
    await db.exec(migrationSql);

    await db.exec(`
      insert into public.hfc_users (id, email, rut, payload)
      values (
        'functional-user',
        'functional@example.com',
        '12.345.678-5',
        '{"name":"Titular funcional","phone":"+56911111111"}'::jsonb
      );

      insert into public.hfc_orders (id, user_id, status, total, payload)
      values ('functional-order', 'functional-user', 'paid', 10000, '{}'::jsonb);

      insert into public.hfc_payments (id, order_id, payload)
      values (
        'functional-payment',
        'functional-order',
        '{"status":"approved","paidAt":"2026-09-03T12:00:00Z"}'::jsonb
      );

      insert into public.hfc_special_passes (
        id, order_id, user_id, code, status, piston_count, created_at, payload
      ) values (
        'functional-pass',
        'functional-order',
        'functional-user',
        'PASS-FUNCTIONAL',
        'valid',
        3,
        '2026-01-01T00:00:00Z',
        '{
          "campaignId":"hfc-2026-special-pass",
          "eventId":"honda-fest-chile-2026",
          "holderRut":"12.345.678-5",
          "holderEmail":"functional@example.com",
          "holderPhone":"+56911111111",
          "termsVersion":"functional-v1",
          "termsAcceptedAt":"2026-09-05T12:00:00Z",
          "notEntryAcceptedAt":"2026-09-05T12:00:01Z",
          "notEntryNoticeHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          "drawEntryCodes":["PISTON-F01","PISTON-F02","PISTON-F03"]
        }'::jsonb
      );

      insert into public.hfc_special_prizes (
        id,
        campaign_id,
        event_id,
        code,
        name,
        prize_type,
        presence_required,
        event_entry_required,
        status
      ) values (
        'functional-onsite-prize',
        'hfc-2026-special-pass',
        'honda-fest-chile-2026',
        'functional-onsite-prize',
        'Premio presencial funcional',
        'onsite',
        true,
        true,
        'draft'
      );
    `);

    const pistons = await db.query(`
      select ordinal, code, holder_rut, issued_at, created_at
      from public.hfc_pistons
      where special_pass_id = 'functional-pass'
      order by ordinal
    `);
    assert.equal(pistons.rows.length, 3);
    assert.ok(pistons.rows.every((row) => row.holder_rut === "123456785"));
    assert.ok(
      pistons.rows.every(
        (row) => row.issued_at.getTime() > new Date("2026-01-01T00:00:00Z").getTime()
      )
    );
    const originalFirstPistonIssuedAt = pistons.rows[0].issued_at.toISOString();

    await expectDatabaseError(
      () =>
        db.query(`
          update public.hfc_special_passes
          set payload = payload || '{"holderRut":"11.111.111-1"}'::jsonb
          where id = 'functional-pass'
        `),
      /RUT del titular del Pase no coincide con el RUT canonico del usuario/
    );
    const canonicalPassRut = await db.query(`
      select holder_rut from public.hfc_special_passes where id = 'functional-pass'
    `);
    assert.equal(canonicalPassRut.rows[0].holder_rut, "123456785");

    // Reintentos conservan issued_at; al aumentar el nivel solo el nuevo
    // Piston recibe una fecha real de emision, nunca pass.created_at.
    await db.query(`
      update public.hfc_special_passes
      set payload = payload || '{"functionalRetry":true}'::jsonb
      where id = 'functional-pass'
    `);
    const retriedFirstPiston = await db.query(`
      select issued_at from public.hfc_pistons where id = 'functional-pass:piston:001'
    `);
    assert.equal(retriedFirstPiston.rows[0].issued_at.toISOString(), originalFirstPistonIssuedAt);
    await db.query(`
      update public.hfc_special_passes
      set
        piston_count = 4,
        payload = jsonb_set(
          payload,
          '{drawEntryCodes}',
          '["PISTON-F01","PISTON-F02","PISTON-F03","PISTON-F04"]'::jsonb
        )
      where id = 'functional-pass'
    `);
    const increasedPiston = await db.query(`
      select piston.issued_at, pass.created_at as pass_created_at
      from public.hfc_pistons piston
      join public.hfc_special_passes pass on pass.id = piston.special_pass_id
      where piston.id = 'functional-pass:piston:004'
    `);
    assert.ok(increasedPiston.rows[0].issued_at.getTime() > increasedPiston.rows[0].pass_created_at.getTime());
    await db.query(`
      update public.hfc_special_passes
      set
        piston_count = 3,
        payload = jsonb_set(
          payload,
          '{drawEntryCodes}',
          '["PISTON-F01","PISTON-F02","PISTON-F03"]'::jsonb
        )
      where id = 'functional-pass'
    `);

    const legacyAcceptances = await db.query(`
      select acceptance_type, document_version
      from public.hfc_order_acceptances
      where special_pass_id = 'functional-pass'
      order by acceptance_type
    `);
    assert.deepEqual(
      legacyAcceptances.rows.map((row) => row.acceptance_type),
      ["not_an_entry"]
    );

    // Un premio seed draft/legal pendiente no puede producir manifiesto.
    await expectDatabaseError(
      () =>
        db.query(`
          select public.hfc_create_draw_manifest(
            'hfc-2026-automobile',
            'functional-test',
            '{}'::jsonb
          )
        `),
      /no esta programado con bases aprobadas, versionadas y hasheadas/
    );
    await db.exec(`
      update public.hfc_special_prizes
      set
        status = 'scheduled',
        payload = payload || '{
          "legalStatus":"approved",
          "rulesVersion":"upgrade-rules-v2",
          "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }'::jsonb
      where id = 'hfc-2026-automobile'
    `);
    await db.exec(`
      update public.hfc_settings
      set payload = payload || '{
        "rulesPublished":true,
        "rulesVersion":"upgrade-rules-v2",
        "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }'::jsonb
      where id = 'special_pass_config'
    `);

    await expectDatabaseError(
      () =>
        db.query(`
          select public.hfc_create_draw_manifest(
            'hfc-2026-automobile',
            'functional-test-before-draw-date',
            '{}'::jsonb
          )
        `),
      /No se puede crear el manifiesto antes de la fecha programada del premio/
    );
    await db.query(`
      update public.hfc_special_prizes
      set draw_on = current_date
      where id = 'hfc-2026-automobile'
    `);

    // Aun pagada, una orden sin aceptacion explicita de esa version no entra.
    await expectDatabaseError(
      () =>
        db.query(`
          select public.hfc_create_draw_manifest(
            'hfc-2026-automobile',
            'functional-test',
            '{}'::jsonb
          )
        `),
      /No hay Pistones elegibles/
    );

    // termsAcceptedAt/termsVersion son legacy genericos: no acreditan las bases
    // nuevas. Solo timestamps y versiones explicitas crean esas evidencias.
    await db.query(`
      update public.hfc_special_passes
      set payload = payload || '{
        "rulesVersion":"upgrade-rules-v1",
        "rulesHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "rulesAcceptedAt":"2026-09-03T13:00:00Z",
        "presenceConditionsVersion":"presence-v1",
        "presenceConditionsHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "presenceConditionsAcceptedAt":"2026-09-03T13:00:01Z",
        "privacyTermsVersion":"privacy-v1",
        "privacyTermsHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "privacyAcceptedAt":"2026-09-03T13:00:02Z"
      }'::jsonb
      where id = 'functional-pass'
    `);
    const versionOneAcceptances = await db.query(`
      select acceptance_type, document_version, accepted_at
      from public.hfc_order_acceptances
      where special_pass_id = 'functional-pass'
      order by acceptance_type, document_version
    `);
    assert.equal(versionOneAcceptances.rows.length, 4);

    // Un payload reintentado con hora anterior no puede retroceder la evidencia.
    await db.query(`
      update public.hfc_special_passes
      set payload = payload || '{
        "rulesAcceptedAt":"2026-09-02T12:30:00Z",
        "presenceConditionsAcceptedAt":"2026-09-02T12:30:01Z"
      }'::jsonb
      where id = 'functional-pass'
    `);
    const nonBackdated = await db.query(`
      select acceptance_type, accepted_at
      from public.hfc_order_acceptances
      where special_pass_id = 'functional-pass'
        and acceptance_type in ('upgrade_terms', 'presence_conditions')
      order by acceptance_type
    `);
    assert.deepEqual(
      nonBackdated.rows.map((row) => row.accepted_at.toISOString()),
      ["2026-09-03T13:00:01.000Z", "2026-09-03T13:00:00.000Z"]
    );

    // Una version nueva crea evidencia separada en vez de reescribir la anterior.
    await db.query(`
      update public.hfc_special_passes
      set payload = payload || '{
        "rulesVersion":"upgrade-rules-v2",
        "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "rulesAcceptedAt":"2026-09-04T13:00:00Z",
        "presenceConditionsVersion":"presence-v2",
        "presenceConditionsHash":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "presenceConditionsAcceptedAt":"2026-09-04T13:00:01Z"
      }'::jsonb
      where id = 'functional-pass'
    `);
    const acceptances = await db.query(`
      select acceptance_type, document_version
      from public.hfc_order_acceptances
      where special_pass_id = 'functional-pass'
      order by acceptance_type, document_version
    `);
    assert.equal(acceptances.rows.length, 6);
    assert.deepEqual(
      acceptances.rows.filter((row) => row.acceptance_type === "upgrade_terms").map((row) => row.document_version),
      ["upgrade-rules-v1", "upgrade-rules-v2"]
    );
    assert.equal(
      acceptances.rows.filter((row) => row.acceptance_type === "privacy").length,
      1
    );

    await expectDatabaseError(
      () =>
        db.query(`
          update public.hfc_order_acceptances
          set accepted_at = accepted_at + interval '1 minute'
          where special_pass_id = 'functional-pass' and acceptance_type = 'upgrade_terms'
        `),
      /aceptaciones registradas son inmutables/
    );
    await expectDatabaseError(
      () =>
        db.query(`
          delete from public.hfc_order_acceptances
          where special_pass_id = 'functional-pass' and acceptance_type = 'privacy'
        `),
      /aceptaciones registradas son inmutables/
    );

    // La misma version no puede mutar silenciosamente a otro documento. El
    // trigger conserva el primer hash y un premio configurado con el hash
    // distinto no encuentra Pistones elegibles.
    await expectDatabaseError(
      () =>
        db.query(`
          update public.hfc_special_passes
          set payload = payload || '{
            "rulesHash":"9999999999999999999999999999999999999999999999999999999999999999",
            "rulesAcceptedAt":"2026-09-04T14:00:00Z"
          }'::jsonb
          where id = 'functional-pass'
        `),
      /misma version de una aceptacion no puede cambiar de hash/
    );
    const immutableHash = await db.query(`
      select document_hash_sha256
      from public.hfc_order_acceptances
      where special_pass_id = 'functional-pass'
        and acceptance_type = 'upgrade_terms'
        and document_version = 'upgrade-rules-v2'
    `);
    assert.equal(
      immutableHash.rows[0].document_hash_sha256,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
    await db.exec(`
      update public.hfc_special_prizes
      set payload = payload || '{"rulesHash":"9999999999999999999999999999999999999999999999999999999999999999"}'::jsonb
      where id = 'hfc-2026-automobile';
      update public.hfc_settings
      set payload = payload || '{"rulesHash":"9999999999999999999999999999999999999999999999999999999999999999"}'::jsonb
      where id = 'special_pass_config';
    `);
    await expectDatabaseError(
      () =>
        db.query(`select public.hfc_create_draw_manifest('hfc-2026-automobile', 'hash-mismatch', '{}'::jsonb)`),
      /No hay Pistones elegibles/
    );
    await db.exec(`
      update public.hfc_special_prizes
      set payload = payload || '{"rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb
      where id = 'hfc-2026-automobile';
      update public.hfc_settings
      set payload = payload || '{"rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb
      where id = 'special_pass_config';
    `);

    // Dos Pistones de control: uno tiene bases aceptadas pero orden unpaid; el
    // otro tiene orden paid pero solo termsAcceptedAt legacy. Ninguno participa.
    await db.exec(`
      insert into public.hfc_orders (id, user_id, status, total, payload) values
        ('functional-unpaid-order', 'functional-user', 'pending', 5000, '{}'::jsonb),
        ('functional-no-rules-order', 'functional-user', 'paid', 5000, '{}'::jsonb);

      insert into public.hfc_payments (id, order_id, payload) values
        (
          'functional-unpaid-payment',
          'functional-unpaid-order',
          '{"status":"pending","paidAt":"2026-09-03T12:00:00Z"}'::jsonb
        ),
        (
          'functional-no-rules-payment',
          'functional-no-rules-order',
          '{"status":"approved","paidAt":"2026-09-03T12:00:00Z"}'::jsonb
        );

      insert into public.hfc_special_passes (
        id, order_id, user_id, code, status, piston_count, payload
      ) values
        (
          'functional-unpaid-pass',
          'functional-unpaid-order',
          'functional-user',
          'PASS-UNPAID',
          'valid',
          1,
          '{
            "campaignId":"hfc-2026-special-pass",
            "eventId":"honda-fest-chile-2026",
            "holderRut":"12.345.678-5",
            "rulesVersion":"upgrade-rules-v2",
            "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "rulesAcceptedAt":"2026-09-04T13:10:00Z",
            "drawEntryCodes":["PISTON-UNPAID"]
          }'::jsonb
        ),
        (
          'functional-no-rules-pass',
          'functional-no-rules-order',
          'functional-user',
          'PASS-NO-RULES',
          'valid',
          1,
          '{
            "campaignId":"hfc-2026-special-pass",
            "eventId":"honda-fest-chile-2026",
            "holderRut":"12.345.678-5",
            "termsVersion":"legacy-v1",
            "termsAcceptedAt":"2026-09-04T13:10:00Z",
            "drawEntryCodes":["PISTON-NO-RULES"]
          }'::jsonb
        );

      insert into public.hfc_orders (id, user_id, status, total, payload)
      values ('functional-future-order', 'functional-user', 'paid', 5000, '{}'::jsonb);
      insert into public.hfc_payments (id, order_id, payload)
      values (
        'functional-future-payment',
        'functional-future-order',
        '{"status":"approved","paidAt":"2026-09-04T12:00:00Z"}'::jsonb
      );
      insert into public.hfc_special_passes (
        id, order_id, user_id, code, status, piston_count, payload
      ) values (
        'functional-future-pass',
        'functional-future-order',
        'functional-user',
        'PASS-FUTURE',
        'valid',
        0,
        '{
          "campaignId":"hfc-2026-special-pass",
          "eventId":"honda-fest-chile-2026",
          "rulesVersion":"upgrade-rules-v2",
          "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "rulesAcceptedAt":"2026-09-04T13:20:00Z"
        }'::jsonb
      );
      insert into public.hfc_pistons (
        id, special_pass_id, order_id, user_id, campaign_id, event_id,
        ordinal, code, holder_rut, status, issued_at
      ) values (
        'functional-future-piston',
        'functional-future-pass',
        'functional-future-order',
        'functional-user',
        'hfc-2026-special-pass',
        'honda-fest-chile-2026',
        1,
        'PISTON-FUTURE',
        '123456785',
        'valid',
        statement_timestamp() + interval '1 day'
      );
    `);
    const derivedFuturePassRut = await db.query(`
      select holder_rut from public.hfc_special_passes where id = 'functional-future-pass'
    `);
    assert.equal(derivedFuturePassRut.rows[0].holder_rut, "123456785");
    const validPistonControlCount = await db.query(`
      select count(*)::integer as count from public.hfc_pistons where status = 'valid'
    `);
    assert.equal(validPistonControlCount.rows[0].count, 6);

    // Automovil: presence_required=false/event_entry_required=false, por lo que
    // los Pistones participan aunque todavia no exista check-in ni entrada.
    const automobileManifest = await db.query(`
      select public.hfc_create_draw_manifest(
        'hfc-2026-automobile',
        'functional-test',
        '{}'::jsonb
      ) as id
    `);
    const automobileManifestId = automobileManifest.rows[0].id;
    const automobileSnapshot = await db.query(
      `select entries_count, digest_sha256 from public.hfc_draw_manifests where id = $1`,
      [automobileManifestId]
    );
    assert.equal(automobileSnapshot.rows[0].entries_count, 3);
    assert.match(automobileSnapshot.rows[0].digest_sha256, /^[0-9a-f]{64}$/);
    const futureEntry = await db.query(
      `select count(*)::integer as count from public.hfc_draw_entries where manifest_id = $1 and piston_id = 'functional-future-piston'`,
      [automobileManifestId]
    );
    assert.equal(futureEntry.rows[0].count, 0);

    // El premio presencial tambien debe pasar de draft a scheduled con la misma
    // version de bases antes de evaluar asistencia/entrada.
    await expectDatabaseError(
      () =>
        db.query(`
          select public.hfc_create_draw_manifest(
            'functional-onsite-prize',
            'functional-test',
            '{}'::jsonb
          )
        `),
      /no esta programado con bases aprobadas, versionadas y hasheadas/
    );
    await db.query(`
      update public.hfc_special_prizes
      set
        status = 'scheduled',
        draw_on = current_date,
        payload = payload || '{
          "legalStatus":"approved",
          "rulesVersion":"upgrade-rules-v2",
          "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }'::jsonb
      where id = 'functional-onsite-prize'
    `);
    await expectDatabaseError(
      () =>
        db.query(`
          select public.hfc_create_draw_manifest(
            'functional-onsite-prize',
            'functional-test',
            '{}'::jsonb
          )
        `),
      /No hay Pistones elegibles/
    );

    await db.query(`
      update public.hfc_special_passes
      set payload = payload || '{"entryValidationStatus":"valid","attendanceStatus":"present"}'::jsonb
      where id = 'functional-pass'
    `);
    const onsiteManifest = await db.query(`
      select public.hfc_create_draw_manifest(
        'functional-onsite-prize',
        'functional-test',
        '{}'::jsonb
      ) as id
    `);
    const onsiteCount = await db.query(
      `select entries_count from public.hfc_draw_manifests where id = $1`,
      [onsiteManifest.rows[0].id]
    );
    assert.equal(onsiteCount.rows[0].entries_count, 3);

    // El resultado ignora identidad/contacto enviados por el caller y toma el
    // snapshot sellado. La fila del Piston se revalida bajo FOR UPDATE.
    const automobileEntries = await db.query(
      `select id, piston_id from public.hfc_draw_entries where manifest_id = $1 order by entry_position`,
      [automobileManifestId]
    );
    await db.query(`update public.hfc_special_prizes set status = 'draft' where id = 'hfc-2026-automobile'`);
    await expectDatabaseError(
      () =>
        db.query(`insert into public.hfc_draw_results (id, draw_entry_id) values ($1, $2)`, [
          "functional-result-draft-prize",
          automobileEntries.rows[0].id
        ]),
      /premio no esta programado con las mismas bases aprobadas/i
    );
    await db.query(`
      update public.hfc_special_prizes
      set status = 'scheduled', payload = jsonb_set(payload, '{legalStatus}', '"pending_final_rules"'::jsonb)
      where id = 'hfc-2026-automobile';
    `);
    await expectDatabaseError(
      () =>
        db.query(`insert into public.hfc_draw_results (id, draw_entry_id) values ($1, $2)`, [
          "functional-result-pending-rules",
          automobileEntries.rows[0].id
        ]),
      /premio no esta programado con las mismas bases aprobadas/i
    );
    await db.query(`
      update public.hfc_special_prizes
      set payload = jsonb_set(payload, '{legalStatus}', '"approved"'::jsonb)
      where id = 'hfc-2026-automobile'
    `);
    await db.query(`
      update public.hfc_special_prizes
      set draw_on = current_date + 1
      where id = 'hfc-2026-automobile'
    `);
    await expectDatabaseError(
      () =>
        db.query(`insert into public.hfc_draw_results (id, draw_entry_id) values ($1, $2)`, [
          "functional-result-before-draw-date",
          automobileEntries.rows[0].id
        ]),
      /No se puede registrar un resultado antes de la fecha programada del premio/
    );
    await db.query(`
      update public.hfc_special_prizes
      set draw_on = current_date
      where id = 'hfc-2026-automobile'
    `);
    await db.query(
      `
        insert into public.hfc_draw_results (
          id, draw_entry_id, winner_name, winner_email, winner_phone
        ) values ($1, $2, 'Nombre falso', 'spoof@example.com', '+56000000000')
      `,
      ["functional-result-rejected", automobileEntries.rows[0].id]
    );
    const sourcedWinner = await db.query(`
      select winner_name, winner_email, winner_phone
      from public.hfc_draw_results
      where id = 'functional-result-rejected'
    `);
    assert.deepEqual(sourcedWinner.rows[0], {
      winner_name: "Titular funcional",
      winner_email: "functional@example.com",
      winner_phone: "+56911111111"
    });

    // Otro manifiesto de la misma version logica no puede registrar un segundo
    // ganador activo con el mismo prize_id/rank. La segunda llamada se ejecuta
    // dentro de una transaccion ya iniciada para validar cutoff <= sealed_at.
    await db.exec(`begin`);
    await db.query(`select now()`);
    const replacementManifest = await db.query(`
      select public.hfc_create_draw_manifest(
        'hfc-2026-automobile',
        'functional-test-replacement',
        '{}'::jsonb
      ) as id
    `);
    await db.exec(`commit`);
    const replacementEntries = await db.query(
      `select id, piston_id from public.hfc_draw_entries where manifest_id = $1 order by entry_position`,
      [replacementManifest.rows[0].id]
    );
    await expectDatabaseError(
      () =>
        db.query(`insert into public.hfc_draw_results (id, draw_entry_id, rank) values ($1, $2, 1)`, [
          "functional-duplicate-active-result",
          replacementEntries.rows[0].id
        ]),
      /hfc_draw_results_active_prize_rank_unique|duplicate key/
    );

    // Revocar antes de seleccionar invalida la entrada sellada. El FOR UPDATE
    // del trigger serializa esta comprobacion con el mismo UPDATE de reembolso.
    await db.query(`
      update public.hfc_special_passes
      set
        piston_count = 2,
        payload = jsonb_set(payload, '{drawEntryCodes}', '["PISTON-F01","PISTON-F02"]'::jsonb)
      where id = 'functional-pass'
    `);
    await expectDatabaseError(
      () =>
        db.query(`insert into public.hfc_draw_results (id, draw_entry_id, rank) values ($1, $2, 2)`, [
          "functional-revoked-result",
          replacementEntries.rows[2].id
        ]),
      /Piston seleccionado ya no esta vigente/
    );
    await db.query(`
      update public.hfc_special_passes
      set
        piston_count = 3,
        payload = jsonb_set(
          payload,
          '{drawEntryCodes}',
          '["PISTON-F01","PISTON-F02","PISTON-F03"]'::jsonb
        )
      where id = 'functional-pass'
    `);

    // Los estados terminales cancelan trabajos que aun no fueron enviados.
    await db.query(`update public.hfc_draw_results set status = 'rejected' where id = 'functional-result-rejected'`);
    const rejectedOutbox = await db.query(`
      select channel, status
      from public.hfc_notification_outbox
      where draw_result_id = 'functional-result-rejected'
      order by channel
    `);
    assert.deepEqual(
      rejectedOutbox.rows.map((row) => row.status),
      ["cancelled", "cancelled"]
    );

    await db.query(
      `insert into public.hfc_draw_results (id, draw_entry_id, rank) values ($1, $2, 1)`,
      ["functional-result-replacement", replacementEntries.rows[0].id]
    );
    await db.query(
      `insert into public.hfc_draw_results (id, draw_entry_id, rank) values ($1, $2, 2)`,
      ["functional-result-expired", replacementEntries.rows[1].id]
    );
    await db.query(`update public.hfc_draw_results set status = 'expired' where id = 'functional-result-expired'`);
    await db.query(
      `insert into public.hfc_draw_results (id, draw_entry_id, rank) values ($1, $2, 3)`,
      ["functional-result-void", replacementEntries.rows[2].id]
    );
    await db.query(`update public.hfc_draw_results set status = 'void' where id = 'functional-result-void'`);
    const terminalOutbox = await db.query(`
      select result.status as result_status, array_agg(outbox.status order by outbox.channel) as outbox_statuses
      from public.hfc_draw_results result
      join public.hfc_notification_outbox outbox on outbox.draw_result_id = result.id
      where result.id in ('functional-result-rejected', 'functional-result-expired', 'functional-result-void')
      group by result.id, result.status
      order by result.status
    `);
    assert.equal(terminalOutbox.rows.length, 3);
    assert.ok(terminalOutbox.rows.every((row) => row.outbox_statuses.every((status) => status === "cancelled")));

    // Un reembolso posterior a la seleccion revoca los Pistones, marca void el
    // resultado activo y cancela sus contactos pendientes en la misma escritura.
    await db.query(`
      update public.hfc_special_passes
      set status = 'refunded'
      where id = 'functional-pass'
    `);
    const refundedWinner = await db.query(`
      select result.status, array_agg(outbox.status order by outbox.channel) as outbox_statuses
      from public.hfc_draw_results result
      join public.hfc_notification_outbox outbox on outbox.draw_result_id = result.id
      where result.id = 'functional-result-replacement'
      group by result.id, result.status
    `);
    assert.equal(refundedWinner.rows[0].status, "void");
    assert.deepEqual(refundedWinner.rows[0].outbox_statuses, ["cancelled", "cancelled"]);

    // Prepara un manifiesto draft para demostrar los dos intentos de movimiento:
    // desde un manifiesto sellado y hacia un manifiesto sellado.
    await db.exec(`
      insert into public.hfc_draw_manifests (
        id, prize_id, version, status, source_cutoff_at, entries_count
      ) values (
        'functional-draft-manifest',
        'hfc-2026-automobile',
        99,
        'draft',
        now(),
        1
      );

      insert into public.hfc_draw_entries (
        id,
        manifest_id,
        piston_id,
        entry_position,
        piston_code,
        holder_rut,
        eligibility_status
      ) values (
        'functional-draft-entry',
        'functional-draft-manifest',
        'functional-pass:piston:001',
        1,
        'PISTON-F01',
        '123456785',
        'eligible'
      );
    `);

    await db.exec(`set role service_role`);
    await expectDatabaseError(
      () =>
        db.query(`
          update public.hfc_order_acceptances
          set accepted_at = now()
          where special_pass_id = 'functional-pass'
        `),
      /permission denied|aceptaciones registradas son inmutables/i
    );
    await expectDatabaseError(
      () =>
        db.query(`
          update public.hfc_draw_manifests
          set
            status = 'sealed',
            sealed_at = now(),
            entries_count = 1,
            digest_sha256 = '0000000000000000000000000000000000000000000000000000000000000000',
            payload = payload || '{
              "rulesVersion":"upgrade-rules-v2",
              "rulesHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            }'::jsonb
          where id = 'functional-draft-manifest'
        `),
      /Solo hfc_create_draw_manifest puede sellar un manifiesto/
    );
    await db.exec(`reset role`);

    await expectDatabaseError(
      () =>
        db.query(`
          update public.hfc_pistons
          set order_id = 'functional-no-rules-order'
          where id = 'functional-pass:piston:001'
        `),
      /identidad de un Piston incluido en un manifiesto sellado/
    );

    const sealedEntry = await db.query(
      `select id from public.hfc_draw_entries where manifest_id = $1 order by entry_position limit 1`,
      [automobileManifestId]
    );
    await expectDatabaseError(
      () =>
        db.query(`update public.hfc_draw_entries set manifest_id = $1 where id = $2`, [
          "functional-draft-manifest",
          sealedEntry.rows[0].id
        ]),
      /manifiesto sellado son inmutables/
    );
    await expectDatabaseError(
      () =>
        db.query(`update public.hfc_draw_entries set manifest_id = $1 where id = 'functional-draft-entry'`, [
          automobileManifestId
        ]),
      /manifiesto sellado son inmutables/
    );

    const integrityBeforeRerun = await db.query(
      `
        select
          manifest.entries_count,
          manifest.digest_sha256,
          count(entry.id)::integer as actual_entries
        from public.hfc_draw_manifests manifest
        left join public.hfc_draw_entries entry on entry.manifest_id = manifest.id
        where manifest.id = $1
        group by manifest.id
      `,
      [automobileManifestId]
    );
    assert.equal(integrityBeforeRerun.rows[0].entries_count, 3);
    assert.equal(integrityBeforeRerun.rows[0].actual_entries, 3);

    // Segunda aplicacion sobre datos y manifiestos existentes: debe ser segura e
    // idempotente y no puede alterar el snapshot sellado.
    await db.exec(migrationSql);
    const integrityAfterRerun = await db.query(
      `
        select
          manifest.entries_count,
          manifest.digest_sha256,
          count(entry.id)::integer as actual_entries
        from public.hfc_draw_manifests manifest
        left join public.hfc_draw_entries entry on entry.manifest_id = manifest.id
        where manifest.id = $1
        group by manifest.id
      `,
      [automobileManifestId]
    );
    assert.deepEqual(integrityAfterRerun.rows[0], integrityBeforeRerun.rows[0]);

    const config = await db.query(`
      select payload from public.hfc_settings where id = 'special_pass_config'
    `);
    assert.equal(config.rows[0].payload.active, false);
    assert.equal(config.rows[0].payload.rulesPublished, false);
    assert.equal(config.rows[0].payload.eventDate, "2026-11-29");
    assert.equal(config.rows[0].payload.customPreserved, "yes");

    console.log(
      JSON.stringify({
        ok: true,
        idempotent: true,
        automobileWithoutPresence: automobileSnapshot.rows[0].entries_count,
        unpaidOrUnacceptedExcluded: validPistonControlCount.rows[0].count - automobileSnapshot.rows[0].entries_count,
        draftOrPendingPrizeBlocked: true,
        onsiteBeforeValidation: 0,
        onsiteAfterValidation: onsiteCount.rows[0].entries_count,
        sealedEntryMoveBlockedBothDirections: true,
        sealedDigestPreserved: true,
        winnerIdentityFromSnapshot: true,
        duplicateActivePrizeRankBlocked: true,
        revokedPistonResultBlocked: true,
        terminalOutboxCancelled: terminalOutbox.rows.length,
        canonicalRutGuard: canonicalPassRut.rows[0].holder_rut === "123456785",
        pistonIssuedAtPreservedOnRetry:
          retriedFirstPiston.rows[0].issued_at.toISOString() === originalFirstPistonIssuedAt,
        drawDateGuards: true,
        genericTermsIgnored: legacyAcceptances.rows.length === 1,
        versionedReacceptances: acceptances.rows.length,
        acceptances: acceptances.rows.length,
        pistons: pistons.rows.length,
        killSwitch: {
          active: config.rows[0].payload.active,
          rulesPublished: config.rows[0].payload.rulesPublished,
          eventDate: config.rows[0].payload.eventDate
        }
      })
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
