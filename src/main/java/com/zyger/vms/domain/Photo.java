package com.zyger.vms.domain;

import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A camera photo of a visitor (keyed by visit code) or a vehicle (keyed by entry code). */
@Entity
@Table(name = "photos")
public class Photo {

    @Id
    @Column(name = "code", length = 20)
    private String code;

    @Column(name = "content_type", nullable = false, length = 50)
    private String contentType;

    @Column(name = "data", nullable = false)
    private byte[] data;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected Photo() {
    }

    public Photo(String code, String contentType, byte[] data) {
        this.code = code;
        this.contentType = contentType;
        this.data = data;
        this.createdAt = LocalDateTime.now();
    }

    public String getCode() { return code; }
    public String getContentType() { return contentType; }
    public byte[] getData() { return data; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
