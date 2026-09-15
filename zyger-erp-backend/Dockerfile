# syntax=docker/dockerfile:1.7

# ---- Build stage: compile and package the Spring Boot executable JAR ----
FROM eclipse-temurin:25-jdk-alpine AS build
WORKDIR /app

# Install gradle wrapper deps and cache dependencies first (better layer caching)
# --chmod=755 makes gradlew executable regardless of host file permissions
# (required because FileZilla uploads may not preserve the executable bit).
COPY settings.gradle build.gradle ./
COPY --chmod=755 gradlew ./
COPY gradle gradle
# Cache the Gradle dependency/wrapper download dir across builds (BuildKit
# cache mount) so redeploys don't re-download the internet every time.
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon dependencies > /dev/null 2>&1 || true

# Copy sources and build the executable JAR (bootJar)
COPY src src
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon bootJar -x test

# ---- Runtime stage: minimal JRE only (no compiler/tools) ----
FROM eclipse-temurin:25-jre-alpine AS runtime

# Install curl for the container health check only (minimal increase)
RUN apk add --no-cache curl \
    && rm -rf /var/cache/apk/*

# Create non-root user for security (alpine style)
RUN addgroup -S appuser && adduser -S -G appuser -h /app -s /sbin/nologin appuser

WORKDIR /app

# Create uploads directory (mounted as a persistent volume at runtime)
RUN mkdir -p /app/uploads && chown -R appuser:appuser /app

# Copy the Spring Boot executable JAR as app.jar
COPY --from=build /app/build/libs/app.jar /app/app.jar

# Set ownership and switch to non-root user
RUN chown appuser:appuser /app/app.jar
USER appuser

ENV SPRING_PROFILES_ACTIVE=staging \
    TZ=Asia/Kolkata \
    SERVER_PORT=9090

EXPOSE 9090

# Health check using Spring Boot Actuator (health is exposed on the internal network only)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:9090/actuator/health || exit 1

# -XX:MaxRAMPercentage/-XX:InitialRAMPercentage let the JVM heap scale with
# whatever memory the container actually gets instead of a fixed 512m (which
# was tight enough to cause GC pauses / slow responses under load).
# TieredStopAtLevel=1 + no JIT background compilation threads beyond CPU
# count trims a bit of startup time; safe defaults for a small staging box.
ENTRYPOINT ["java", \
  "-XX:InitialRAMPercentage=50.0", \
  "-XX:MaxRAMPercentage=75.0", \
  "-XX:+UseG1GC", \
  "-XX:+UseContainerSupport", \
  "-jar", "/app/app.jar"]
