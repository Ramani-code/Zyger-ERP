package com.zyger.vms.service;

import java.util.Base64;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.zyger.vms.domain.Photo;
import com.zyger.vms.repository.PhotoRepository;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PhotoService {

    /** About 1.1 MB of JPEG; the browser shrinks camera photos well below this. */
    private static final int MAX_BYTES = 1_100_000;
    private static final Pattern DATA_URL =
            Pattern.compile("data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)");

    private final PhotoRepository photos;

    public PhotoService(PhotoRepository photos) {
        this.photos = photos;
    }

    /** Stores a photo sent as a data URL. A blank value means no photo was taken. */
    @Transactional
    public void store(String code, String dataUrl) {
        if (dataUrl == null || dataUrl.isBlank()) {
            return;
        }
        Matcher m = DATA_URL.matcher(dataUrl.trim());
        if (!m.matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The photo must be a JPEG, PNG or WebP image.");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(m.group(2));
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The photo could not be read. Please capture it again.");
        }
        if (bytes.length == 0 || bytes.length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The photo is too large. Please capture it again.");
        }
        photos.save(new Photo(code, m.group(1), bytes));
    }

    /** Removes the photo kept for a visit or vehicle code, if there is one. */
    @Transactional
    public void delete(String code) {
        if (photos.existsById(code)) {
            photos.deleteById(code);
        }
    }

    @Transactional(readOnly = true)
    public Optional<Photo> find(String code) {
        return photos.findById(code);
    }
}
