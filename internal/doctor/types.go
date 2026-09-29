package doctor

type Check struct {
	Name     string `json:"name"`
	OK       bool   `json:"ok"`
	Detail   string `json:"detail"`
	Critical bool   `json:"critical"`
}

type Report struct {
	Checks    []Check  `json:"checks"`
	Errors    []string `json:"errors"`
	Leftovers []string `json:"leftovers"`
}

// add appends a check, recording critical failures in Errors for the
// serve gate and the CLI exit status.
func (r *Report) add(name string, ok bool, detail string, critical bool) {
	r.Checks = append(r.Checks, Check{Name: name, OK: ok, Detail: detail, Critical: critical})
	if critical && !ok {
		r.Errors = append(r.Errors, name+": "+detail)
	}
}

func detail(err error, success string) string {
	if err == nil {
		return success
	}
	return err.Error()
}
