package in.zygertechnology.zygererp.controller;

import in.zygertechnology.zygererp.entity.Attachment;
import in.zygertechnology.zygererp.service.AttachmentService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

@RestController
@RequestMapping("/api/attachments")
public class AttachmentController {

    private final AttachmentService svc;

    public AttachmentController(AttachmentService svc) {
        this.svc = svc;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(
            @RequestParam String ownerType,
            @RequestParam Long ownerId,
            @RequestParam(required = false, defaultValue = "OTHER") String category,
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-User-Id", defaultValue = "system") String user) throws IOException {

        Attachment att = svc.upload(ownerType, ownerId, category, file, user);
        return svc.toSummary(att);
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam String ownerType, @RequestParam Long ownerId) {
        return svc.list(ownerType, ownerId).stream().map(svc::toSummary).toList();
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id,
                       @RequestHeader(value = "X-User-Id", defaultValue = "system") String user) {
        svc.softDelete(id, user);
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> download(@PathVariable Long id) throws IOException {
        Attachment att = svc.getById(id);
        byte[] bytes = Files.readAllBytes(Path.of(att.getStoragePath()));
        MediaType type;
        try {
            type = att.getContentType() != null ? MediaType.parseMediaType(att.getContentType()) : MediaType.APPLICATION_OCTET_STREAM;
        } catch (Exception ex) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.ok()
                .contentType(type)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline().filename(att.getFileName() != null ? att.getFileName() : "file").build().toString())
                .body(bytes);
    }
}
