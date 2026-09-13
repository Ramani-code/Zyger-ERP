package in.zygertechnology.zygererp.service;

import in.zygertechnology.zygererp.entity.Attachment;
import in.zygertechnology.zygererp.entity.PlantMaster;
import in.zygertechnology.zygererp.config.BusinessRuleException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class AttachmentService {

    @PersistenceContext
    private EntityManager em;

    private static final String UPLOAD_DIR = "uploads";

    /** FRS §9: MIME allowlist for upload security */
    private static final Set<String> ALLOWED_MIME = Set.of(
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "application/pdf",
            "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain", "text/csv",
            "application/dwg", "application/dxf"
    );

    /** Magic-byte signatures for common file types */
    private static final Map<String, byte[]> MAGIC_BYTES = Map.of(
            "image/jpeg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF},
            "image/png", new byte[]{(byte) 0x89, (byte) 0x50, (byte) 0x4E, (byte) 0x47},
            "image/gif", new byte[]{0x47, 0x49, 0x46, 0x38},
            "application/pdf", new byte[]{0x25, 0x50, 0x44, 0x46}
    );

    /** FRS §6.3, §6.4: Mandatory-attachment rules per doc type + severity */
    private static final Map<String, Set<String>> MANDATORY_CATEGORIES = Map.of(
            "quality-ncr", Set.of("PHOTO"),
            "quality-8d", Set.of("PHOTO", "DOCUMENT"),
            "quality-customer-complaint", Set.of("DOCUMENT")
    );

    @Transactional
    public Attachment upload(String ownerType, Long ownerId, String category,
                             MultipartFile file, String uploadedBy) throws IOException {
        // FRS §9: MIME allowlist validation
        String contentType = file.getContentType();
        if (contentType != null && !ALLOWED_MIME.contains(contentType.toLowerCase())) {
            throw new BusinessRuleException("INVALID_MIME",
                    "File type " + contentType + " is not allowed. Allowed: images, PDF, Word, Excel, text.",
                    Map.of("contentType", contentType, "allowed", ALLOWED_MIME));
        }

        // FRS §9: Magic-byte verification for common types
        if (contentType != null && MAGIC_BYTES.containsKey(contentType.toLowerCase())) {
            byte[] header = new byte[8];
            int read = file.getInputStream().read(header);
            file.getInputStream().reset();
            byte[] expected = MAGIC_BYTES.get(contentType.toLowerCase());
            boolean matches = true;
            for (int i = 0; i < expected.length && i < read; i++) {
                if (header[i] != expected[i]) { matches = false; break; }
            }
            if (!matches) {
                throw new BusinessRuleException("MIME_MISMATCH",
                        "File content does not match declared type " + contentType,
                        Map.of("contentType", contentType));
            }
        }

        Path ownerDir = Path.of(UPLOAD_DIR, ownerType, String.valueOf(ownerId));
        Files.createDirectories(ownerDir);

        String safeName = file.getOriginalFilename() != null
                ? file.getOriginalFilename().replaceAll("[^a-zA-Z0-9._-]", "_")
                : "file";
        String stored = System.currentTimeMillis() + "_" + safeName;
        Path target = ownerDir.resolve(stored);
        file.transferTo(target.toFile());

        String checksum = sha256(target);

        PlantMaster plant = em.find(PlantMaster.class, 1L);

        Attachment att = Attachment.builder()
                .plant(plant)
                .ownerType(ownerType)
                .ownerId(ownerId)
                .fileName(file.getOriginalFilename())
                .contentType(contentType)
                .sizeBytes(file.getSize())
                .storagePath(target.toString())
                .checksumSha256(checksum)
                .category(category != null ? category : "OTHER")
                .uploadedBy(uploadedBy)
                .uploadedAt(Instant.now())
                .build();
        em.persist(att);
        return att;
    }

    /**
     * FRS §6.3, §6.4: Validate mandatory-attachment rules before a document can be closed.
     * Returns true if all required categories have at least one attachment.
     */
    public boolean validateMandatoryAttachments(String ownerType, Long ownerId) {
        Set<String> required = MANDATORY_CATEGORIES.get(ownerType);
        if (required == null || required.isEmpty()) return true;

        List<Attachment> existing = list(ownerType, ownerId);
        Set<String> existingCats = existing.stream()
                .map(Attachment::getCategory)
                .filter(c -> c != null)
                .map(String::toUpperCase)
                .collect(java.util.stream.Collectors.toSet());

        for (String cat : required) {
            if (!existingCats.contains(cat)) return false;
        }
        return true;
    }

    @Transactional(readOnly = true)
    public Attachment getById(Long id) {
        Attachment att = em.find(Attachment.class, id);
        if (att == null || att.getDeletedAt() != null) {
            throw new IllegalArgumentException("Attachment not found: " + id);
        }
        return att;
    }

    @Transactional(readOnly = true)
    public List<Attachment> list(String ownerType, Long ownerId) {
        return em.createQuery(
                "SELECT a FROM Attachment a WHERE a.ownerType = :ot AND a.ownerId = :oid AND a.deletedAt IS NULL ORDER BY a.uploadedAt DESC",
                Attachment.class)
                .setParameter("ot", ownerType)
                .setParameter("oid", ownerId)
                .getResultList();
    }

    @Transactional
    public void softDelete(Long id, String deletedBy) {
        Attachment att = em.find(Attachment.class, id);
        if (att != null) {
            att.setDeletedAt(Instant.now());
        }
    }

    @Transactional(readOnly = true)
    public Map<String, Object> toSummary(Attachment a) {
        return Map.of(
                "id", a.getId(),
                "fileName", a.getFileName(),
                "contentType", a.getContentType() != null ? a.getContentType() : "",
                "sizeBytes", a.getSizeBytes() != null ? a.getSizeBytes() : 0L,
                "category", a.getCategory(),
                "uploadedBy", a.getUploadedBy() != null ? a.getUploadedBy() : "",
                "uploadedAt", a.getUploadedAt() != null ? a.getUploadedAt().toString() : ""
        );
    }

    private String sha256(Path path) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = Files.readAllBytes(path);
            byte[] hash = md.digest(bytes);
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException | IOException e) {
            return "unknown";
        }
    }
}
