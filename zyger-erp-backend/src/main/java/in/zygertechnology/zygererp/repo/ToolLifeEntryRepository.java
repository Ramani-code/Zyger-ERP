package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.ToolLifeEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ToolLifeEntryRepository extends JpaRepository<ToolLifeEntry, Long> {
    List<ToolLifeEntry> findByToolCodeOrderByCreatedAtDesc(String toolCode);
    List<ToolLifeEntry> findByJobCardNumber(String jobCardNumber);
    List<ToolLifeEntry> findAllByOrderByCreatedAtDesc();
}
