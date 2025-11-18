package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
)

var (
	discordToken             = os.Getenv("DISCORD_API_KEY")
	discordAdminID           = os.Getenv("DISCORD_ADMIN_ID")
	discordNotificationsChan = os.Getenv("DISCORD_NOTIFICATIONS_CHANNEL_ID")
	laravelAPIURL            = os.Getenv("LARAVEL_API_URL")
	laravelAPIToken          = os.Getenv("LARAVEL_API_TOKEN")

	httpClient = &http.Client{
		Timeout: 10 * time.Second,
	}
)

func main() {
	dg, err := discordgo.New("Bot " + discordToken)
	if err != nil {
		fmt.Printf("Error creating Discord session: %v\n", err)
		return
	}

	dg.AddHandler(ready)
	dg.AddHandler(interactionCreate)

	err = dg.Open()
	if err != nil {
		fmt.Printf("Error opening connection: %v\n", err)
		return
	}
	defer func(dg *discordgo.Session) {
		err := dg.Close()
		if err != nil {
			fmt.Printf("Error closing Discord session: %v\n", err)
		}
	}(dg)

	// Register slash commands
	registerCommands(dg)

	// Start background task
	go notificationLoop(dg)

	// Keep the bot running
	select {}
}

func ready(_ *discordgo.Session, _ *discordgo.Ready) {
	fmt.Println("Bot is ready")
}

func registerCommands(s *discordgo.Session) {
	commands := []*discordgo.ApplicationCommand{
		{
			Name:        "search",
			Description: "Search for games",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "name",
					Description: "Game name to search",
					Required:    true,
				},
			},
		},
	}

	// Register commands individually for v0.28.1 compatibility
	for _, cmd := range commands {
		_, err := s.ApplicationCommandCreate(s.State.User.ID, "", cmd)
		if err != nil {
			fmt.Printf("Error creating %s command: %v\n", cmd.Name, err)
		}
	}
}

func interactionCreate(s *discordgo.Session, i *discordgo.InteractionCreate) {
	switch i.ApplicationCommandData().Name {
	case "search":
		handleSearch(s, i)
	}
}

func handleSearch(s *discordgo.Session, i *discordgo.InteractionCreate) {
	options := i.ApplicationCommandData().Options
	name := options[0].StringValue()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		resp, err := apiRequest(ctx, "POST", "/discord/search", map[string]string{
			"name": name,
		})

		var response string
		if err != nil {
			response = fmt.Sprintf("Error: %v", err)
		} else {
			if resp["matches"].(float64) > 0 {
				var builder strings.Builder
				builder.WriteString(fmt.Sprintf("Found %.0f matches for \"%s\":\n",
					resp["matches"].(float64), name))

				for _, game := range resp["games"].([]interface{}) {
					g := game.(map[string]interface{})

					// Convert the published_at timestamp to string if it's a float64
					publishedAt := ""
					switch v := g["published_at"].(type) {
					case string:
						publishedAt = v
					case float64:
						publishedAt = fmt.Sprintf("%.0f", v)
					default:
						publishedAt = fmt.Sprintf("%v", v)
					}

					url := extractURL(g["url"])

					builder.WriteString(fmt.Sprintf(
						"%s, Latest Version: %s, Last Updated At: <t:%s:f> <%s>\n",
						g["name"], g["version"], publishedAt, url,
					))
				}
				response = builder.String()
			} else {
				response = fmt.Sprintf("Found no matches for \"%s\"", name)
			}
		}

		sendFollowup(s, i, response)
	}()

	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})
	if err != nil {
		return
	}
}

func notificationLoop(s *discordgo.Session) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		// Process legacy updates
		processUpdates(s)
		// Process new user-based notifications
		processUserNotifications(s)
		// Process addition request notifications
		processAdditionRequestNotifications(s)
	}
}

func processUpdates(s *discordgo.Session) {
	fmt.Println("\n[processUpdates] Start")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := apiRequest(ctx, "POST", "/discord/updates", nil)
	if err != nil {
		fmt.Printf("Error fetching updates: %v\n", err)
		return
	}

	if updates, ok := resp["updates"].([]interface{}); ok && len(updates) > 0 {
		messageChunks := buildUpdateMessages(updates)

		if users, ok := resp["discord_users"].([]interface{}); ok {
			for _, userID := range users {
				go sendUserNotifications(s, userID.(string), messageChunks)
			}
		}

		if shouldNotifyChannel(resp["discord_users"].([]interface{})) {
			go sendChannelNotifications(s, messageChunks)
		}
	}
}

func processUserNotifications(s *discordgo.Session) {
	fmt.Println("\n[processUserNotifications] Start")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Get pending notifications
	resp, err := apiRequest(ctx, "GET", "/discord-notifications/pending", nil)
	if err != nil {
		fmt.Printf("Error fetching pending notifications: %v\n", err)
		return
	}

	notifications, ok := resp["notifications"].([]interface{})
	if !ok || len(notifications) == 0 {
		return
	}

	batchKey := resp["batch_key"].(string)
	results := make([]map[string]interface{}, 0, len(notifications))

	// Process each notification
	for _, n := range notifications {
		notif := n.(map[string]interface{})
		notificationID := int64(notif["notification_id"].(float64))
		discordUserID := notif["discord_user_id"].(string)
		game := notif["game"].(map[string]interface{})
		isDigest := notif["is_digest"].(bool)
		digestType := notif["digest_type"]

		// Handle URL which can be a string or a map
		gameURL := extractURL(game["url"])

		// Handle devlog_url which can be a string or nil
		devlogURL := ""
		if dv, ok := game["devlog_url"].(string); ok {
			devlogURL = dv
		}

		// Format the word count diff message
		var wordCountMsg string
		if wordCountDiff, ok := game["word_count_diff"].(float64); ok && wordCountDiff != 0 {
			comparedVersion := game["compared_to_version"].(map[string]interface{})
			compareType := "previous version"
			if comparedVersion["is_last_read"].(bool) {
				compareType = "your last read"
			}
			wordCountMsg = fmt.Sprintf("\nWord count change from %s (%s): %+.0f words",
				compareType,
				comparedVersion["version"].(string),
				wordCountDiff)
		}

		var message string
		if isDigest {
			digestTypeStr := "Game Updates"
			if digestType != nil {
				switch digestType.(string) {
				case "daily":
					digestTypeStr = "Daily Game Updates"
				case "weekly":
					digestTypeStr = "Weekly Game Updates"
				}
			}
			message = fmt.Sprintf("%s\n%s\nVersion: %s\nReleased: <t:%d:f>\n%s\nGame: <%s>\nDevlog: <%s>",
				digestTypeStr,
				game["name"],
				game["version"],
				int64(game["published_at"].(float64)),
				wordCountMsg,
				gameURL,
				devlogURL,
			)
		} else {
			message = fmt.Sprintf("New Update Available!\n\n%s\nVersion: %s\nReleased: <t:%d:f>\n%s\nGame: <%s>\nDevlog: <%s>",
				game["name"],
				game["version"],
				int64(game["published_at"].(float64)),
				wordCountMsg,
				gameURL,
				devlogURL,
			)
		}

		// Try to send DM to user
		success := true
		var errorMsg string

		user, err := s.User(discordUserID)
		if err != nil {
			success = false
			errorMsg = fmt.Sprintf("Error fetching user: %v", err)
		} else {
			channel, err := s.UserChannelCreate(user.ID)
			if err != nil {
				success = false
				errorMsg = fmt.Sprintf("Error creating DM channel: %v", err)
			} else {
				_, err = s.ChannelMessageSend(channel.ID, message)
				if err != nil {
					success = false
					errorMsg = fmt.Sprintf("Error sending DM: %v", err)
				}
			}
		}

		// Record result
		results = append(results, map[string]interface{}{
			"notification_id": notificationID,
			"success":         success,
			"error":           errorMsg,
		})
	}

	// Record delivery status
	statusResp, err := apiRequest(ctx, "POST", "/discord-notifications/status", map[string]interface{}{
		"batch_key":     batchKey,
		"notifications": results,
	})

	if err != nil {
		fmt.Printf("Error recording notification status: %v\n", err)
	} else {
		fmt.Printf("Notification status recorded: %v\n", statusResp["message"])
	}
}

func processAdditionRequestNotifications(s *discordgo.Session) {
	fmt.Println("\n[processAdditionRequestNotifications] Start")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Get pending addition request notifications
	resp, err := apiRequest(ctx, "GET", "/discord-notifications/addition-requests", map[string]interface{}{
		"limit": 20,
		"since": time.Now().Add(-5 * time.Minute).Format(time.RFC3339), // Last 5 minutes
	})
	if err != nil {
		fmt.Printf("Error fetching addition request notifications: %v\n", err)
		return
	}

	notifications, ok := resp["notifications"].([]interface{})
	if !ok || len(notifications) == 0 {
		return
	}

	adminPanelURL, _ := resp["admin_panel_url"].(string)

	// Send notifications to admin channel
	if discordNotificationsChan != "" {
		for _, notification := range notifications {
			n := notification.(map[string]interface{})
			url := n["url"].(string)
			userCount := int(n["user_count"].(float64))
			users := n["users"].([]interface{})

			// Build user list
			var userNames []string
			for _, user := range users {
				u := user.(map[string]interface{})
				userNames = append(userNames, u["name"].(string))
			}

			message := fmt.Sprintf("🎮 **New VN Addition Request**\n\n"+
				"**URL:** %s\n"+
				"**Requested by:** %s (%d user%s)\n"+
				"**Admin Panel:** <%s>",
				url,
				strings.Join(userNames, ", "),
				userCount,
				func() string {
					if userCount != 1 {
						return "s"
					}
					return ""
				}(),
				adminPanelURL,
			)

			_, err = s.ChannelMessageSend(discordNotificationsChan, message)
			if err != nil {
				fmt.Printf("Error sending addition request notification: %v\n", err)
			} else {
				fmt.Printf("Sent addition request notification for: %s\n", url)
			}
		}
	}
}

func buildUpdateMessages(updates []interface{}) []string {
	var chunks []string
	var currentChunk strings.Builder

	currentChunk.WriteString(fmt.Sprintf("Found %d new updates:\n", len(updates)))

	for _, update := range updates {
		u := update.(map[string]interface{})

		// Convert the published_at timestamp to string if it's a float64
		publishedAt := ""
		switch v := u["published_at"].(type) {
		case string:
			publishedAt = v
		case float64:
			publishedAt = fmt.Sprintf("%.0f", v)
		default:
			publishedAt = fmt.Sprintf("%v", v)
		}

		url := extractURL(u["url"])

		entry := fmt.Sprintf(
			"%s, Latest Version: %s, Last Updated At: <t:%s:f> <%s> | <%s>\n",
			u["name"], u["version"], publishedAt, url, u["devlog"],
		)

		if currentChunk.Len()+len(entry) > 1900 {
			chunks = append(chunks, currentChunk.String())
			currentChunk.Reset()
		}
		currentChunk.WriteString(entry)
	}

	if currentChunk.Len() > 0 {
		chunks = append(chunks, currentChunk.String())
	}

	return chunks
}

func sendUserNotifications(s *discordgo.Session, userID string, chunks []string) {
	user, err := s.User(userID)
	if err != nil {
		fmt.Printf("Error fetching user %s: %v\n", userID, err)
		return
	}

	channel, err := s.UserChannelCreate(user.ID)
	if err != nil {
		fmt.Printf("Error creating DM channel: %v\n", err)
		return
	}

	for _, chunk := range chunks {
		_, err = s.ChannelMessageSend(channel.ID, chunk)
		if err != nil {
			fmt.Printf("Error sending DM to %s: %v\n", userID, err)
		}
	}
}

func sendChannelNotifications(s *discordgo.Session, chunks []string) {
	if discordNotificationsChan == "" {
		return
	}

	channel, err := s.Channel(discordNotificationsChan)
	if err != nil {
		fmt.Printf("Error fetching notifications channel: %v\n", err)
		return
	}

	for _, chunk := range chunks {
		_, err = s.ChannelMessageSend(channel.ID, chunk)
		if err != nil {
			fmt.Printf("Error sending channel notification: %v\n", err)
		}
	}
}

func shouldNotifyChannel(users []interface{}) bool {
	for _, user := range users {
		if user.(string) == discordAdminID {
			return true
		}
	}
	return false
}

func apiRequest(ctx context.Context, method string, path string, data interface{}) (map[string]interface{}, error) {
	reqBody, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	apiPath := "/api" + path

	req, err := http.NewRequestWithContext(ctx, method, laravelAPIURL+apiPath, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+laravelAPIToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	fmt.Printf("Making request to: %s%s\n", laravelAPIURL, apiPath)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {
			fmt.Printf("Error closing response body: %v\n", err)
		}
	}(resp.Body)

	// Read the entire response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %v", err)
	}

	// Log response status and first part of body for debugging
	fmt.Printf("Response status: %s\n", resp.Status)
	bodyPreview := string(bodyBytes)
	if len(bodyPreview) > 100 {
		bodyPreview = bodyPreview[:100] + "..."
	}
	fmt.Printf("Response body preview: %s\n", bodyPreview)

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API request failed: %s, body: %s", resp.Status, bodyPreview)
	}

	// Parse the JSON response
	var result map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, fmt.Errorf("JSON parsing error: %v, body: %s", err, bodyPreview)
	}

	return result, nil
}

func sendFollowup(s *discordgo.Session, i *discordgo.InteractionCreate, message string) {
	_, err := s.FollowupMessageCreate(i.Interaction, true, &discordgo.WebhookParams{
		Content: message,
	})
	if err != nil {
		fmt.Printf("Error sending followup: %v\n", err)
	}
}

func extractURL(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case map[string]interface{}:
		// Try to find a valid URL in order of preference
		if u, ok := val["itch_io"].(string); ok && u != "" {
			return u
		} else if u, ok := val["steam"].(string); ok && u != "" {
			return u
		} else if u, ok := val["other"].(string); ok && u != "" {
			return u
		}
	}
	return ""
}
