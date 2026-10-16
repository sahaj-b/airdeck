package relay

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ErrConflict reports a claim lost to another key or a tombstoned code.
var ErrConflict = errors.New("room code is claimed by another installation")

// ErrChangeLimit reports the daily code-change cap.
var ErrChangeLimit = errors.New("code change limit reached for today")

// Claim is one durable row.
type Claim struct {
	RoomCode        string
	InstallationKey string
	Retired         bool
}

// Store is the durable claim database.
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
);
CREATE INDEX IF NOT EXISTS idx_claims_key ON claims(installation_key, retired);`
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

// Lookup returns the durable row for one normalized code.
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

// ActiveForKey returns the active code owned by one key, or empty.
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
}

// Register atomically claims code for key; a same-key move tombstones
// the old row and claims the new one in the same transaction.
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
		if isUniqueViolation(err) {
			return RegisterResult{}, ErrConflict
		}
		return RegisterResult{}, fmt.Errorf("insert claim: %w", err)
	}
	if err := tx.Commit(); err != nil {
		if isUniqueViolation(err) {
			return RegisterResult{}, ErrConflict
		}
		return RegisterResult{}, fmt.Errorf("commit claim: %w", err)
	}
	return result, nil
}

// RegisterWithLimit claims code for key while enforcing the daily
// code-change cap atomically: the active-claim check, tombstone, insert,
// and change-count increment all run in one transaction, so concurrent
// registers cannot both pass the cap and a crash cannot grant a free
// change. Same-code re-register touches without burning the cap.
func (s *Store) RegisterWithLimit(code, key, day string, maxChanges int) (RegisterResult, error) {
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
		// Unclaimed: fall through.
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
			if isUniqueViolation(err) {
				return RegisterResult{}, ErrConflict
			}
			return RegisterResult{}, fmt.Errorf("commit claim: %w", err)
		}
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
	default:
		if active != code {
			var count int
			err = tx.QueryRow(
				`SELECT count FROM code_changes WHERE installation_key = ? AND day = ?`, key, day,
			).Scan(&count)
			switch {
			case errors.Is(err, sql.ErrNoRows):
				count = 0
			case err != nil:
				return RegisterResult{}, fmt.Errorf("lookup change count: %w", err)
			}
			if count >= maxChanges {
				return RegisterResult{}, ErrChangeLimit
			}
			if _, err := tx.Exec(
				`UPDATE claims SET retired = 1, updated_at = ? WHERE room_code = ?`, now, active,
			); err != nil {
				return RegisterResult{}, fmt.Errorf("tombstone old code: %w", err)
			}
			result.ChangedFrom = active
			if _, err := tx.Exec(
				`INSERT INTO code_changes(installation_key, day, count) VALUES(?, ?, 1)
				 ON CONFLICT(installation_key, day) DO UPDATE SET count = count + 1`,
				key, day,
			); err != nil {
				return RegisterResult{}, fmt.Errorf("record code change: %w", err)
			}
		}
	}

	if _, err := tx.Exec(
		`INSERT INTO claims(room_code, installation_key, retired, created_at, updated_at) VALUES(?, ?, 0, ?, ?)`,
		code, key, now, now,
	); err != nil {
		if isUniqueViolation(err) {
			return RegisterResult{}, ErrConflict
		}
		return RegisterResult{}, fmt.Errorf("insert claim: %w", err)
	}
	if err := tx.Commit(); err != nil {
		if isUniqueViolation(err) {
			return RegisterResult{}, ErrConflict
		}
		return RegisterResult{}, fmt.Errorf("commit claim: %w", err)
	}
	return result, nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "constraint failed") ||
		strings.Contains(msg, "already exists")
}

// ChangeCount returns how many code changes key burned today.
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
