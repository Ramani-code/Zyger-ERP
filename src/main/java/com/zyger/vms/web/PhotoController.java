package com.zyger.vms.web;

import java.time.Duration;

import com.zyger.vms.service.PhotoService;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/photos")
public class PhotoController {

    private final PhotoService service;

    public PhotoController(PhotoService service) {
        this.service = service;
    }

    @GetMapping("/{code}")
    public ResponseEntity<byte[]> get(@PathVariable("code") String code) {
        return service.find(code.trim())
                .map(p -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(p.getContentType()))
                        .cacheControl(CacheControl.maxAge(Duration.ofHours(1)))
                        .body(p.getData()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No photo for " + code));
    }
}
