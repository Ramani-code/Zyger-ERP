package in.zygertechnology.zygererp.entity;

import jakarta.persistence.*;
import lombok.*;
import in.zygertechnology.zygererp.config.AuditEntityListener;
import java.time.Instant;
import java.time.LocalDate;

/** One row per drawing revision. Only one revision per {@code drawingNumber} may be "Active"
 * at a time — saving a new Active revision auto-supersedes the prior one (see MasterController). */
@Entity @Table(name = "drawing_revision")
@EntityListeners(AuditEntityListener.class)
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class DrawingRevision {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;
    @Column(name = "drawing_number", length = 100) String drawingNumber;
    @Column(length = 20) String revision;
    @Column(name = "effective_date") LocalDate effectiveDate;
    @Column(name = "attached_file_path", length = 500) String attachedFilePath;
    @Column(length = 20) @Builder.Default String status = "Active";

    String createdBy;
    Instant createdAt;
    String updatedBy;
    Instant updatedAt;
    @Version Long version;
}
