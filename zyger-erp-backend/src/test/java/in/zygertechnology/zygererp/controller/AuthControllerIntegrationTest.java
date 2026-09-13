package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.AbstractPostgresIntegrationTest;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for AuthController.
 * Tests authentication, registration, and token refresh flows.
 * Runs against an isolated PostgreSQL Testcontainer so it never touches the
 * dev/seed database (which contains a 'demo' user guarded by ProdSafetyCheck).
 */
@DisplayName("Auth Controller Integration Tests")
class AuthControllerIntegrationTest extends AbstractPostgresIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    @DisplayName("POST /api/auth/login - should reject invalid credentials")
    void shouldRejectInvalidCredentials() throws Exception {
        Map<String, String> body = Map.of(
                "username", "nonexistent",
                "password", "wrongpassword"
        );

        // Contract: failed login surfaces as a 400 Bad Request (IllegalArgumentException),
        // matching the existing AuthControllerTest expectations and GlobalExceptionHandler.
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("POST /api/auth/login - should reject missing fields")
    void shouldRejectMissingFields() throws Exception {
        Map<String, String> body = Map.of();

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("POST /api/auth/signup - should create new user")
    void shouldCreateNewUser() throws Exception {
        Map<String, String> body = Map.of(
                "displayName", "Test User",
                "username", "testuser_" + System.currentTimeMillis(),
                "password", "TestPass123!",
                "email", "test@example.com"
        );

        // Contract: signup requires displayName and returns {message, username} (no accessToken).
        mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").exists())
                .andExpect(jsonPath("$.message").exists());
    }

    @Test
    @DisplayName("POST /api/auth/signup - should reject duplicate username")
    void shouldRejectDuplicateUsername() throws Exception {
        String uniqueUser = "dupuser_" + System.currentTimeMillis();
        Map<String, String> body = Map.of(
                "displayName", "Dup User",
                "username", uniqueUser,
                "password", "TestPass123!",
                "email", "dup@example.com"
        );

        // First signup should succeed
        mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());

        // Contract: duplicate username surfaces as a 400 Bad Request
        // (IllegalArgumentException("Username already exists")), not 409.
        mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("POST /api/auth/refresh - should reject invalid refresh token")
    void shouldRejectInvalidRefreshToken() throws Exception {
        Map<String, String> body = Map.of(
                "refreshToken", "invalid-token-12345"
        );

        // Contract: an invalid refresh token is rejected with a 400 Bad Request
        // (IllegalArgumentException), consistent with the app's validation handling.
        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("GET /api/auth/me - should require authentication")
    void shouldRequireAuthentication() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("POST /api/auth/logout - should succeed")
    void shouldLogout() throws Exception {
        // Contract: logout expects a JSON body (@RequestBody Map). An empty object body is
        // accepted (no refreshToken -> nothing to revoke) and returns 200.
        mockMvc.perform(post("/api/auth/logout")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());
    }
}
