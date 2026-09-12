package relay

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// ErrConflict reports a claim that loses: the code is active under another
// installation key, or it is tombstoned (retired codes burn permanently
// and are never reassigned, not even to the installation that burned
// them).
var ErrConflict = errors.New("room code is claimed by another installation")

// ErrNotOwner reports a code change whose old code is not actively owned
// by the calling installation key.
var ErrNotOwner = errors.New("old room code is not owned by this installation")

// Claim is one durable row: the normalized code, the owning installation
// key, and whether the code is tombstoned.
type Claim struct {
	RoomCode        string
	InstallationKey string
	Retired         bool
}

// Store is the durable claim database. Rows are hundreds of bytes and the
// relay writes on register only, so a single serialized connection is
// plenty (and it keeps :memory: databases correct in tests).
type Store struct {
	db *sql.DB
}

// Open creates the schema if needed and returns the store.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open claim database: %w", err)
	}
	db.SetMaxOpenConns(1)
	schema := `
CREATE TABLE IF NOT EXISTS claims(
	room_code TEXT PRIMARY KEY,
	installation_key TEXT NOT NULL,
	retired INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS code_changes(
	installation_key TEXT NOT NULL,
	day TEXT NOT NULL,
	count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(installation_key, day)
);`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate claim database: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the database.
func (s *Store) Close() error {
	return s.db.Close()
}

// Lookup returns the durable row for one normalized code, or
// sql.ErrNoRows when the code was never claimed.
func (s *Store) Lookup(code string) (Claim, error) {
	var claim Claim
	var retired int
	err := s.db.QueryRow(
		`SELECT room_code, installation_key, retired FROM claims WHERE room_code = ?`, code,
	).Scan(&claim.RoomCode, &claim.InstallationKey, &retired)
	if err != nil {
		return Claim{}, err
	}
	claim.Retired = retired != 0
	return claim, nil
}

// ActiveForKey returns the currently active (non-retired) code owned by
// one installation key, or "" when it owns nothing.
func (s *Store) ActiveForKey(key string) (string, error) {
	var code string
	err := s.db.QueryRow(
		`SELECT room_code FROM claims WHERE installation_key = ? AND retired = 0`, key,
	).Scan(&code)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return code, err
}

// RegisterResult describes what one atomic Register did.
type RegisterResult struct {
	// ChangedFrom is the tombstoned old code when the host moved codes.
	ChangedFrom string
	// Reconnected is true when the host re-registered its own active code.
	Reconnected bool
}

// Register atomically claims code for key: unclaimed inserts, same-key
// active touches updated_at (host restart re-register), anything else
// conflicts. A same-key register for a different code is a code change:
// the old row tombstones (retired=1, key kept) and the new row claims in
// the same transaction, so a crash never orphans or double-owns a code.
func (s *Store) Register(code, key string) (RegisterResult, error) {
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return RegisterResult{}, fmt.Errorf("begin claim: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var result RegisterResult

	var existingKey string
	var retired int
	err = tx.QueryRow(
		`SELECT installation_key, retired FROM claims WHERE room_code = ?`, code,
	).Scan(&existingKey, &retired)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Unclaimed: fall through to the change-or-insert below.
	case err != nil:
		return RegisterResult{}, fmt.Errorf("lookup claim: %w", err)
	case retired != 0 || existingKey != key:
		return RegisterResult{}, ErrConflict
	default:
		if _, err := tx.Exec(
			`UPDATE claims SET updated_at = ? WHERE room_code = ?`, now, code,
		); err != nil {
			return RegisterResult{}, fmt.Errorf("touch claim: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return RegisterResult{}, fmt.Errorf("commit claim: %w", err)
		}
		result.Reconnected = true
		return result, nil
	}

	var active string
	err = tx.QueryRow(
		`SELECT room_code FROM claims WHERE installation_key = ? AND retired = 0`, key,
	).Scan(&active)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// First claim for this installation.
	case err != nil:
		return RegisterResult{}, fmt.Errorf("lookup active claim: %w", err)
	case active == code:
		// Same-key active row the SELECT above somehow missed; treat as
		// reconnect rather than erroring a live host.
		if _, err := tx.Exec(
			`UPDATE claims SET updated_at = ? WHERE room_code = ?`, now, code,
		); err != nil {
			return RegisterResult{}, fmt.Errorf("touch claim: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return RegisterResult{}, fmt.Errorf("commit claim: %w", err)
		}
		result.Reconnected = true
		return result, nil
	default:
		if _, err := tx.Exec(
			`UPDATE claims SET retired = 1, updated_at = ? WHERE room_code = ?`, now, active,
		); err != nil {
			return RegisterResult{}, fmt.Errorf("tombstone old code: %w", err)
		}
		result.ChangedFrom = active
	}

	if _, err := tx.Exec(
		`INSERT INTO claims(room_code, installation_key, retired, created_at, updated_at) VALUES(?, ?, 0, ?, ?)`,
		code, key, now, now,
	); err != nil {
		return RegisterResult{}, fmt.Errorf("insert claim: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return RegisterResult{}, fmt.Errorf("commit claim: %w", err)
	}
	return result, nil
}

// ClaimGenerated claims a fresh generated code for key, regenerating on
// collision inside the same transaction. A tombstoned code never gets
// reused: retired rows collide like active ones and force a retry.
//
// TODO(phase-7): no caller yet. Unlike Register it does not tombstone the
// key's existing active code, so the dashboard "Generate new code" path
// must either call Register (which owns the single-active invariant) or
// gain tombstoning here before use.
func (s *Store) ClaimGenerated(key string, generate func() string, tries int) (string, error) {
	if tries <= 0 {
		tries = 10
	}
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return "", fmt.Errorf("begin generated claim: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for i := 0; i < tries; i++ {
		code := generate()
		res, err := tx.Exec(
			`INSERT OR IGNORE INTO claims(room_code, installation_key, retired, created_at, updated_at) VALUES(?, ?, 0, ?, ?)`,
			code, key, now, now,
		)
		if err != nil {
			return "", fmt.Errorf("insert generated claim: %w", err)
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return "", fmt.Errorf("generated claim rows: %w", err)
		}
		if affected == 1 {
			if err := tx.Commit(); err != nil {
				return "", fmt.Errorf("commit generated claim: %w", err)
			}
			return code, nil
		}
	}
	return "", fmt.Errorf("generated %d colliding codes in a row: %w", tries, ErrConflict)
}

// ChangeCount returns how many code changes key already burned today (UTC).
func (s *Store) ChangeCount(key, day string) (int, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT count FROM code_changes WHERE installation_key = ? AND day = ?`, key, day,
	).Scan(&count)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return count, err
}

// RecordChange burns one of key's daily code changes.
func (s *Store) RecordChange(key, day string) error {
	_, err := s.db.Exec(
		`INSERT INTO code_changes(installation_key, day, count) VALUES(?, ?, 1)
		 ON CONFLICT(installation_key, day) DO UPDATE SET count = count + 1`,
		key, day,
	)
	if err != nil {
		return fmt.Errorf("record code change: %w", err)
	}
	return nil
}
