package com.zyger.vms.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(Cors cors) {

    public record Cors(List<String> allowedOrigins) {
    }
}
