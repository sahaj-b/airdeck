package session

const maxPlayers = 16

var slotAccents = [...]string{
	"#6ee7b7", "#60a5fa", "#fbbf24", "#f472b6",
	"#a78bfa", "#fb7185", "#2dd4bf", "#c084fc",
	"#facc15", "#38bdf8", "#fb923c", "#4ade80",
	"#e879f9", "#f87171", "#818cf8", "#a3e635",
}

func firstFree(slots [maxPlayers]*Player) int {
	for i, player := range slots {
		if player == nil {
			return i
		}
	}
	return -1
}
