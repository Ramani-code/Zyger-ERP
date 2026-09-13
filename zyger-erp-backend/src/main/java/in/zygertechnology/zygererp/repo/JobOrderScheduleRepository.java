package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.JobOrderSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface JobOrderScheduleRepository extends JpaRepository<JobOrderSchedule, Long> {
    List<JobOrderSchedule> findByDocId(Long docId);
}
