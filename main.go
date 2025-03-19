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
			Name:        "subscribe",
			Description: "Subscribe to game update notifications",
		},
		{
			Name:        "unsubscribe",
			Description: "Unsubscribe from game update notifications",
		},
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
	case "subscribe":
		handleSubscribe(s, i)
	case "unsubscribe":
		handleUnsubscribe(s, i)
	case "search":
		handleSearch(s, i)
	}
}

func handleSubscribe(s *discordgo.Session, i *discordgo.InteractionCreate) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		resp, err := apiRequest(ctx, "POST", "/discord/subscribe", map[string]string{
			"discord_id": i.Member.User.ID,
		})

		response := formatResponse(resp, err, "Subscribed to notifications")
		sendFollowup(s, i, response)
	}()

	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})
	if err != nil {
		return
	}
}

func handleUnsubscribe(s *discordgo.Session, i *discordgo.InteractionCreate) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		resp, err := apiRequest(ctx, "POST", "/discord/unsubscribe", map[string]string{
			"discord_id": i.Member.User.ID,
		})

		response := formatResponse(resp, err, "Unsubscribed from notifications")
		sendFollowup(s, i, response)
	}()

	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})
	if err != nil {
		return
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

					builder.WriteString(fmt.Sprintf(
						"%s, Latest Version: %s, Last Updated At: <t:%s:f> <%s>\n",
						g["name"], g["version"], publishedAt, g["url"],
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
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		processUpdates(s)
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

		entry := fmt.Sprintf(
			"%s, Latest Version: %s, Last Updated At: <t:%s:f> <%s> | <%s>\n",
			u["name"], u["version"], publishedAt, u["url"], u["devlog"],
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

func formatResponse(resp map[string]interface{}, err error, successMsg string) string {
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	if msg, ok := resp["message"].(string); ok {
		return msg
	}
	return successMsg
}

func sendFollowup(s *discordgo.Session, i *discordgo.InteractionCreate, message string) {
	_, err := s.FollowupMessageCreate(i.Interaction, true, &discordgo.WebhookParams{
		Content: message,
	})
	if err != nil {
		fmt.Printf("Error sending followup: %v\n", err)
	}
}
