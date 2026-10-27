-- #40: the default alt text ("<name>, zdjęcie N") is computed at read time from the current name and the
-- position in the displayed gallery. Rows written by #32 stored that text at upload; reset exactly those
-- values to NULL. The expression mirrors defaultImageAlt(name, position): NFC, markup/control/bidi
-- characters to spaces, whitespace collapsed, at most 150 characters, then ", zdjęcie N" (N = position + 1).
-- Compromise: a stored default that no longer equals this value (the vehicle was renamed or the images were
-- reordered after the upload) cannot be told from an editor's text and is kept as written; an editor can
-- clear it. Additive data change only; no column or constraint changes.
UPDATE "VehicleImage" AS image
SET "alt" = NULL
FROM "Vehicle" AS vehicle
WHERE vehicle."id" = image."vehicleId"
  AND vehicle."organizationId" = image."organizationId"
  AND image."alt" IS NOT NULL
  AND image."alt" = CASE
    WHEN btrim(left(btrim(regexp_replace(regexp_replace(normalize(coalesce(vehicle."name", ''), NFC),
      '[<>\u0001-\u001f\u007f-\u009f  ‪-‮⁦-⁩]', ' ', 'g'), '\s+', ' ', 'g')), 150)) = ''
      THEN 'Zdjęcie pojazdu ' || (image."position" + 1)
    ELSE btrim(left(btrim(regexp_replace(regexp_replace(normalize(coalesce(vehicle."name", ''), NFC),
      '[<>\u0001-\u001f\u007f-\u009f  ‪-‮⁦-⁩]', ' ', 'g'), '\s+', ' ', 'g')), 150))
      || ', zdjęcie ' || (image."position" + 1)
  END;
