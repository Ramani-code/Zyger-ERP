package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface DrawingRevisionRepository extends JpaRepository<DrawingRevision, Long> {
    List<DrawingRevision> findByDrawingNumberOrderByEffectiveDateDesc(String drawingNumber);
    List<DrawingRevision> findByDrawingNumberAndStatus(String drawingNumber, String status);
    Optional<DrawingRevision> findFirstByDrawingNumberAndStatus(String drawingNumber, String status);
}
